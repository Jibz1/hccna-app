import { Predicate } from "effect";
import type { Effect } from "effect";
import { atom } from "jotai";
import { fetchQuery, Network } from "relay-runtime";
import type {
  ConcreteRequest,
  Environment as RelayRuntimeEnvironment,
  Variables,
} from "relay-runtime";

import {
  runLiveAppEffect,
  type AppRuntimeServices,
} from "@/effect/appRuntimeLive";
import { connectivity } from "@/effect/connectivity";
import { executeGraphQLRequest } from "@/effect/graphqlNetworkService";
import {
  recordRelayAuthScopeSwitch,
  recordRelayCacheClear,
  recordRelayEnvironmentCreated,
  recordRelayHydration,
  recordRelayRetentionRestore,
  recordRelayRevalidationFailure,
  recordRelayRevalidationSweep,
  type RelayAuthScopeKind,
} from "@/effect/relayPersistenceTelemetryService";
import {
  getLiveStatsigDynamicConfig,
  isLiveStatsigReady,
} from "@/effect/statsigServiceLive";
import { createRelayFetchFunction } from "@/relay/createRelayFetchFunction";
import {
  parseRevalidationConfig,
  RELAY_REVALIDATION_CONFIG_NAME,
  type RevalidationConfig,
} from "@/relay/foregroundRevalidation";
import { getRelayDataID } from "@/relay/getDataID";
import {
  createRelayEnvironmentState,
  type RelayEnvironmentState,
} from "@/relay/relayEnvironmentLifecycle";
import { relayEnvironment, relaySettingsStorage } from "@/utils/mmkv";
import {
  ANONYMOUS_RELAY_AUTH_SCOPE,
  isRelayPersistenceEnabledForLaunch,
  RELAY_CACHE_VERSION,
} from "@/utils/relayPersistence";

export const environmentAtom = atom<RelayEnvironmentState | null>(null);
const relayPersistenceEnabledForCurrentLaunch =
  isRelayPersistenceEnabledForLaunch();

function recordTelemetry(
  effect: Effect.Effect<void, never, AppRuntimeServices>,
): void {
  void runLiveAppEffect(effect).catch(() => undefined);
}

function getScopeKind(authScope: string): RelayAuthScopeKind {
  return authScope === ANONYMOUS_RELAY_AUTH_SCOPE
    ? "anonymous"
    : "authenticated";
}

function getErrorTag(cause: unknown): string {
  if (
    Predicate.isObjectOrArray(cause) &&
    "_tag" in cause &&
    Predicate.isString(cause._tag)
  ) {
    return cause._tag;
  }

  if (cause instanceof Error) {
    return cause.name;
  }

  return "unknown";
}

function getRevalidationConfig(): RevalidationConfig {
  try {
    if (!isLiveStatsigReady()) {
      return parseRevalidationConfig(undefined);
    }

    return parseRevalidationConfig(
      getLiveStatsigDynamicConfig(RELAY_REVALIDATION_CONFIG_NAME).value,
    );
  } catch {
    return parseRevalidationConfig(undefined);
  }
}

function createExecuteFetch(environment: RelayRuntimeEnvironment) {
  return (
    request: ConcreteRequest,
    variables: Variables,
    signal: AbortSignal,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const subscription = fetchQuery(
        environment,
        request,
        variables,
      ).subscribe({
        complete: () => {
          resolve();
        },
        error: (cause: unknown) => {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        },
      });

      // Unsubscribing runs the observable's teardown, which aborts the
      // in-flight network request inside createRelayFetchFunction.
      signal.addEventListener(
        "abort",
        () => {
          subscription.unsubscribe();
          reject(new Error("Revalidation fetch aborted"));
        },
        { once: true },
      );
    });
}

export function recordRelayEnvironmentAuthScopeSwitch(
  previousScope: string,
  nextScope: string,
): void {
  recordTelemetry(
    recordRelayAuthScopeSwitch({
      previousKind: getScopeKind(previousScope),
      nextKind: getScopeKind(nextScope),
    }),
  );
}

export function createEnvironment(authScope: string): RelayEnvironmentState {
  return createRelayEnvironmentState({
    authScope,
    cacheVersion: RELAY_CACHE_VERSION,
    createNetwork: (onSuccessfulQuery) => {
      const relayFetchFunction = createRelayFetchFunction((request) =>
        runLiveAppEffect(executeGraphQLRequest(request)).then(() => {
          // An aborted request never published a response, so it must not
          // stamp the freshness clocks that gate retention and revalidation.
          if (
            !request.signal.aborted &&
            request.operation.operationKind === "query"
          ) {
            onSuccessfulQuery(request.operation.name, request.variables);
          }
        }),
      );

      return Network.create(relayFetchFunction);
    },
    getDataID: getRelayDataID,
    now: Date.now,
    onCacheCleared: (reason) => {
      recordTelemetry(recordRelayCacheClear(reason));
    },
    onEnvironmentCreated: (telemetry) => {
      recordTelemetry(recordRelayEnvironmentCreated(telemetry));
    },
    onHydrated: (telemetry) => {
      recordTelemetry(recordRelayHydration(telemetry));
    },
    onRetentionRestored: (telemetry) => {
      recordTelemetry(recordRelayRetentionRestore(telemetry));
    },
    persistenceEnabled: relayPersistenceEnabledForCurrentLaunch,
    revalidation: {
      createExecuteFetch,
      // Scoped per auth scope: the Relay caches this generation gates are
      // themselves per-scope, so an unscoped key would let the first scope to
      // sweep consume the bump on every other scope's behalf.
      generationStorage: {
        getString: (key) =>
          relaySettingsStorage.getString(`${key}.${authScope}`),
        set: (key, value) => {
          relaySettingsStorage.set(`${key}.${authScope}`, value);
        },
      },
      getConfig: getRevalidationConfig,
      getConnectivityStatus: connectivity.getSnapshot,
      onRevalidationFailure: (operationName, error) => {
        recordTelemetry(
          recordRelayRevalidationFailure({
            errorTag: getErrorTag(error),
            operationName,
          }),
        );
      },
      onSweepCompleted: (stats) => {
        recordTelemetry(recordRelayRevalidationSweep(stats));
      },
      subscribeConnectivityRestored: connectivity.subscribeConnectivityRestored,
      subscribeForegrounded: connectivity.subscribeForegrounded,
    },
    storage: relayEnvironment,
  });
}

export type { RelayEnvironmentState };
