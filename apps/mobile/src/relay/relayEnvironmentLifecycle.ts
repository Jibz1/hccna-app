import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  type EnvironmentConfig,
  type MutableRecordSource,
  type Variables,
} from "relay-runtime";

import type { ConnectivityStatus } from "@/effect/connectivity";
import {
  ForegroundRevalidator,
  type ForegroundRevalidatorOptions,
  type RevalidationConfig,
  type RevalidationGenerationStorage,
  type RevalidationSweepStats,
} from "@/relay/foregroundRevalidation";
import {
  DEFAULT_OFFLINE_QUERY_RETENTION_ALLOWLIST,
  OfflineQueryRetentionRegistry,
  type OfflineQueryRetentionAllowlist,
  type OfflineQueryRetentionRestoreStats,
} from "@/relay/offlineQueryRetention";
import {
  MMKVRecordSource,
  type MMKVRecordSourceOptions,
  type RelayCacheClearReason,
  type RelayHydrationStats,
  type RelayStorageAdapter,
} from "@/utils/relayRecordSource";
import { acquireRelayStorage } from "@/utils/relayStorageLease";

export type RelayEnvironmentState = {
  readonly authScope: string;
  readonly environment: Environment;
  readonly persistenceEnabled: boolean;
  readonly source: MutableRecordSource;
  readonly store: Store;
  readonly dispose: () => void;
};

export type RelayRevalidationWiring = {
  readonly createExecuteFetch: (
    environment: Environment,
  ) => ForegroundRevalidatorOptions["executeFetch"];
  readonly generationStorage: RevalidationGenerationStorage;
  readonly getConfig: () => RevalidationConfig;
  readonly getConnectivityStatus: () => ConnectivityStatus;
  readonly onRevalidationFailure?: (
    operationName: string,
    cause: unknown,
  ) => void;
  readonly onSweepCompleted?: (stats: RevalidationSweepStats) => void;
  readonly subscribeConnectivityRestored: (listener: () => void) => () => void;
  readonly subscribeForegrounded: (listener: () => void) => () => void;
};

export type RelayEnvironmentLifecycleOptions = {
  readonly allowlist?: OfflineQueryRetentionAllowlist;
  readonly authScope: string;
  readonly cacheVersion: string;
  readonly createNetwork: (
    onSuccessfulQuery: (operationName: string, variables: Variables) => void,
  ) => ReturnType<typeof Network.create>;
  readonly getDataID?: EnvironmentConfig["getDataID"];
  readonly hardLimits?: MMKVRecordSourceOptions["hardLimits"];
  readonly measureNow?: () => number;
  readonly now: () => number;
  readonly onCacheCleared?: (reason: RelayCacheClearReason) => void;
  readonly onEnvironmentCreated?: (telemetry: {
    readonly durationMs: number;
    readonly persistenceEnabled: boolean;
  }) => void;
  readonly onHydrated?: (stats: RelayHydrationStats) => void;
  readonly onRetentionRestored?: (
    stats: OfflineQueryRetentionRestoreStats,
  ) => void;
  readonly persistenceEnabled: boolean;
  readonly revalidation?: RelayRevalidationWiring;
  readonly storage?: RelayStorageAdapter;
};

export type ResolveRelayEnvironmentStateOptions = {
  readonly authScope: string;
  readonly createEnvironment: (authScope: string) => RelayEnvironmentState;
  readonly current: RelayEnvironmentState | null;
  readonly isAuthReady: boolean;
  readonly onAuthScopeChanged?: (
    previousScope: string,
    nextScope: string,
  ) => void;
};

export function createRelayEnvironmentState({
  allowlist,
  authScope,
  cacheVersion,
  createNetwork,
  getDataID,
  hardLimits,
  measureNow = () => globalThis.performance.now(),
  now,
  onCacheCleared,
  onEnvironmentCreated,
  onHydrated,
  onRetentionRestored,
  persistenceEnabled,
  revalidation,
  storage,
}: RelayEnvironmentLifecycleOptions): RelayEnvironmentState {
  const startedAt = measureNow();
  let retentionRegistry: OfflineQueryRetentionRegistry | null = null;
  let revalidator: ForegroundRevalidator | null = null;
  let disposed = false;
  let releaseStorage = () => {};
  const activeRequests = new Set<() => void>();
  let source: MutableRecordSource;
  let store: Store;

  if (persistenceEnabled) {
    if (storage === undefined) {
      throw new Error(
        "Relay persistence requires an auth-scoped storage adapter",
      );
    }

    const lease = acquireRelayStorage(storage);
    releaseStorage = lease.dispose;
    const leasedStorage = lease.storage;

    source = new MMKVRecordSource({
      authScope,
      cacheVersion,
      hardLimits,
      measureNow,
      onCacheCleared,
      onHydrated,
      storage: leasedStorage,
    });
    store = new Store(source, {
      gcReleaseBufferSize: 20,
    });
    retentionRegistry = new OfflineQueryRetentionRegistry({
      allowlist,
      authScope,
      gcHold: store.holdGC(),
      now,
      onRestored: onRetentionRestored,
      storage: leasedStorage,
      store,
    });
    retentionRegistry.restore();
  } else {
    source = new RecordSource();
    store = new Store(source);
  }

  const upstreamNetwork = createNetwork((operationName, variables) => {
    if (disposed) {
      return;
    }
    retentionRegistry?.recordSuccessfulQuery(operationName, variables);
    revalidator?.recordSuccessfulFetch(operationName, variables);
  });
  const network = Network.create(
    (operation, variables, cacheConfig, uploadables) =>
      Observable.create((sink) => {
        if (disposed) {
          sink.error(new Error("Relay environment disposed"));
          return;
        }
        const subscription = upstreamNetwork
          .execute(operation, variables, cacheConfig, uploadables)
          .subscribe(sink);
        const cancel = () => {
          subscription.unsubscribe();
          sink.error(new Error("Relay environment disposed"));
        };
        if (!subscription.closed) {
          activeRequests.add(cancel);
        }
        return () => {
          activeRequests.delete(cancel);
          subscription.unsubscribe();
        };
      }),
  );
  const environment = new Environment({
    configName: "hccna",
    getDataID,
    network,
    store,
  });

  onEnvironmentCreated?.({
    durationMs: Math.max(0, measureNow() - startedAt),
    persistenceEnabled,
  });

  const revalidationUnsubscribers: (() => void)[] = [];
  if (revalidation !== undefined) {
    const activeRevalidator = new ForegroundRevalidator({
      allowlist: allowlist ?? DEFAULT_OFFLINE_QUERY_RETENTION_ALLOWLIST,
      executeFetch: revalidation.createExecuteFetch(environment),
      generationStorage: revalidation.generationStorage,
      getConfig: revalidation.getConfig,
      getConnectivityStatus: revalidation.getConnectivityStatus,
      now,
      onRevalidationFailure: revalidation.onRevalidationFailure,
      onSweepCompleted: revalidation.onSweepCompleted,
    });
    activeRevalidator.seedFromManifestEntries(
      retentionRegistry?.getEntries() ?? [],
    );
    revalidationUnsubscribers.push(
      revalidation.subscribeForegrounded(() => {
        void activeRevalidator.sweep("foregrounded").catch(() => undefined);
      }),
      revalidation.subscribeConnectivityRestored(() => {
        void activeRevalidator
          .sweep("connectivity_restored")
          .catch(() => undefined);
      }),
    );
    revalidator = activeRevalidator;
  }

  return {
    authScope,
    environment,
    persistenceEnabled,
    source,
    store,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      releaseStorage();
      activeRequests.forEach((cancel) => {
        cancel();
      });
      revalidationUnsubscribers.forEach((unsubscribe) => {
        unsubscribe();
      });
      revalidator?.dispose();
      retentionRegistry?.dispose();
    },
  };
}

export function resolveRelayEnvironmentState({
  authScope,
  createEnvironment,
  current,
  isAuthReady,
  onAuthScopeChanged,
}: ResolveRelayEnvironmentStateOptions): RelayEnvironmentState | null {
  if (!isAuthReady || current?.authScope === authScope) {
    return current;
  }

  current?.dispose();
  const next = createEnvironment(authScope);

  if (current !== null) {
    onAuthScopeChanged?.(current.authScope, next.authScope);
  }

  return next;
}
