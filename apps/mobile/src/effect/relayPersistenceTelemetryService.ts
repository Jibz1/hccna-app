import { Context, Effect, Metric } from "effect";

import type { RevalidationSweepStats } from "@/relay/foregroundRevalidation";
import type { OfflineQueryRetentionRestoreStats } from "@/relay/offlineQueryRetention";
import type {
  RelayCacheClearReason,
  RelayHydrationStats,
} from "@/utils/relayRecordSource";

export const RELAY_ENVIRONMENT_CREATED_EVENT = "relay_environment_created";
export const RELAY_CACHE_HYDRATED_EVENT = "relay_cache_hydrated";
export const RELAY_CACHE_CLEARED_EVENT = "relay_cache_cleared";
export const RELAY_RETENTION_RESTORED_EVENT = "relay_retention_restored";
export const RELAY_AUTH_SCOPE_SWITCHED_EVENT = "relay_auth_scope_switched";
export const RELAY_REVALIDATION_SWEEP_EVENT = "relay_revalidation_sweep";
export const RELAY_REVALIDATION_FAILURE_EVENT = "relay_revalidation_failure";

export type RelayAuthScopeKind = "anonymous" | "authenticated";

export type RelayPersistenceTelemetryServiceDependencies = {
  readonly logEvent: (
    eventName: string,
    value: number | null,
    metadata: Readonly<Record<string, string>>,
  ) => Effect.Effect<void>;
};

export type RelayPersistenceTelemetryServiceApi = {
  readonly recordAuthScopeSwitch: (input: {
    readonly nextKind: RelayAuthScopeKind;
    readonly previousKind: RelayAuthScopeKind;
  }) => Effect.Effect<void>;
  readonly recordCacheClear: (
    reason: RelayCacheClearReason,
  ) => Effect.Effect<void>;
  readonly recordEnvironmentCreated: (input: {
    readonly durationMs: number;
    readonly persistenceEnabled: boolean;
  }) => Effect.Effect<void>;
  readonly recordHydration: (stats: RelayHydrationStats) => Effect.Effect<void>;
  readonly recordRetentionRestore: (
    stats: OfflineQueryRetentionRestoreStats,
  ) => Effect.Effect<void>;
  readonly recordRevalidationFailure: (input: {
    readonly errorTag: string;
    readonly operationName: string;
  }) => Effect.Effect<void>;
  readonly recordRevalidationSweep: (
    stats: RevalidationSweepStats,
  ) => Effect.Effect<void>;
};

export class RelayPersistenceTelemetryService extends Context.Service<
  RelayPersistenceTelemetryService,
  RelayPersistenceTelemetryServiceApi
>()("RelayPersistenceTelemetryService") {}

const environmentCreationDuration = Metric.histogram(
  "relay_environment_creation_duration_ms",
  {
    description: "Relay environment creation duration in milliseconds",
    boundaries: Metric.exponentialBoundaries({
      start: 1,
      factor: 2,
      count: 12,
    }),
  },
);
const hydrationDuration = Metric.histogram("relay_hydration_duration_ms", {
  description: "Persisted Relay record hydration duration in milliseconds",
  boundaries: Metric.exponentialBoundaries({
    start: 1,
    factor: 2,
    count: 12,
  }),
});
const cacheClearCount = Metric.counter("relay_cache_clear_total", {
  description: "Total persisted Relay cache clears",
  incremental: true,
});
const authScopeSwitchCount = Metric.counter("relay_auth_scope_switch_total", {
  description: "Total Relay environment auth-scope transitions",
  incremental: true,
});
const revalidationSweepCount = Metric.counter(
  "relay_revalidation_sweep_total",
  {
    description: "Total foreground revalidation sweeps",
    incremental: true,
  },
);
const revalidationFailureCount = Metric.counter(
  "relay_revalidation_failure_total",
  {
    description: "Total foreground revalidation fetch failures",
    incremental: true,
  },
);

export function makeRelayPersistenceTelemetryService(
  dependencies: RelayPersistenceTelemetryServiceDependencies,
): RelayPersistenceTelemetryServiceApi {
  const logSafely = (
    eventName: string,
    value: number | null,
    metadata: Readonly<Record<string, string>>,
  ) => Effect.exit(dependencies.logEvent(eventName, value, metadata));

  const recordEnvironmentCreated = Effect.fn(
    "RelayPersistenceTelemetryService.recordEnvironmentCreated",
  )(function* ({
    durationMs,
    persistenceEnabled,
  }: {
    readonly durationMs: number;
    readonly persistenceEnabled: boolean;
  }) {
    const metadata = {
      duration_ms: String(durationMs),
      persistence_enabled: String(persistenceEnabled),
    };

    yield* Metric.update(
      Metric.withAttributes(environmentCreationDuration, {
        persistence_enabled: metadata.persistence_enabled,
      }),
      durationMs,
    );
    yield* logSafely(RELAY_ENVIRONMENT_CREATED_EVENT, durationMs, metadata);
  });

  const recordHydration = Effect.fn(
    "RelayPersistenceTelemetryService.recordHydration",
  )(function* (stats: RelayHydrationStats) {
    const metadata = {
      corrupt_record_count: String(stats.corruptRecordCount),
      duration_ms: String(stats.durationMs),
      record_count: String(stats.recordCount),
      storage_bytes: String(stats.storageBytes),
    };

    yield* Metric.update(hydrationDuration, stats.durationMs);
    yield* logSafely(RELAY_CACHE_HYDRATED_EVENT, stats.recordCount, metadata);
  });

  const recordCacheClear = Effect.fn(
    "RelayPersistenceTelemetryService.recordCacheClear",
  )(function* (reason: RelayCacheClearReason) {
    yield* Metric.update(Metric.withAttributes(cacheClearCount, { reason }), 1);
    yield* logSafely(RELAY_CACHE_CLEARED_EVENT, 1, { reason });
  });

  const recordRetentionRestore = Effect.fn(
    "RelayPersistenceTelemetryService.recordRetentionRestore",
  )(function* (stats: OfflineQueryRetentionRestoreStats) {
    const metadata = {
      discarded_expired: String(stats.discarded.expired),
      discarded_malformed: String(stats.discarded.malformed),
      discarded_missing_records: String(stats.discarded.missing_records),
      discarded_unknown_operation: String(stats.discarded.unknown_operation),
      discarded_variant_limit: String(stats.discarded.variant_limit),
      discarded_wrong_scope: String(stats.discarded.wrong_scope),
      retained_count: String(stats.retainedCount),
    };

    yield* logSafely(
      RELAY_RETENTION_RESTORED_EVENT,
      stats.retainedCount,
      metadata,
    );
  });

  const recordAuthScopeSwitch = Effect.fn(
    "RelayPersistenceTelemetryService.recordAuthScopeSwitch",
  )(function* ({
    nextKind,
    previousKind,
  }: {
    readonly nextKind: RelayAuthScopeKind;
    readonly previousKind: RelayAuthScopeKind;
  }) {
    const metadata = {
      next_kind: nextKind,
      previous_kind: previousKind,
    };

    yield* Metric.update(
      Metric.withAttributes(authScopeSwitchCount, metadata),
      1,
    );
    yield* logSafely(RELAY_AUTH_SCOPE_SWITCHED_EVENT, 1, metadata);
  });

  const recordRevalidationSweep = Effect.fn(
    "RelayPersistenceTelemetryService.recordRevalidationSweep",
  )(function* (stats: RevalidationSweepStats) {
    const metadata = {
      checked: String(stats.checked),
      failed: String(stats.failed),
      generation_bump: String(stats.generationBump),
      refetched: String(stats.refetched),
      skipped_fresh: String(stats.skippedFresh),
      trigger: stats.trigger,
    };

    yield* Metric.update(
      Metric.withAttributes(revalidationSweepCount, { trigger: stats.trigger }),
      1,
    );
    yield* logSafely(RELAY_REVALIDATION_SWEEP_EVENT, stats.refetched, metadata);
  });

  const recordRevalidationFailure = Effect.fn(
    "RelayPersistenceTelemetryService.recordRevalidationFailure",
  )(function* ({
    errorTag,
    operationName,
  }: {
    readonly errorTag: string;
    readonly operationName: string;
  }) {
    yield* Metric.update(
      Metric.withAttributes(revalidationFailureCount, {
        operation_name: operationName,
      }),
      1,
    );
    yield* logSafely(RELAY_REVALIDATION_FAILURE_EVENT, 1, {
      error_tag: errorTag,
      operation_name: operationName,
    });
  });

  return {
    recordAuthScopeSwitch,
    recordCacheClear,
    recordEnvironmentCreated,
    recordHydration,
    recordRetentionRestore,
    recordRevalidationFailure,
    recordRevalidationSweep,
  };
}

export const recordRelayAuthScopeSwitch = Effect.fn(
  "RelayPersistenceTelemetryService.access.recordAuthScopeSwitch",
)(function* (input: {
  readonly nextKind: RelayAuthScopeKind;
  readonly previousKind: RelayAuthScopeKind;
}) {
  const service = yield* RelayPersistenceTelemetryService;
  return yield* service.recordAuthScopeSwitch(input);
});

export const recordRelayCacheClear = Effect.fn(
  "RelayPersistenceTelemetryService.access.recordCacheClear",
)(function* (reason: RelayCacheClearReason) {
  const service = yield* RelayPersistenceTelemetryService;
  return yield* service.recordCacheClear(reason);
});

export const recordRelayEnvironmentCreated = Effect.fn(
  "RelayPersistenceTelemetryService.access.recordEnvironmentCreated",
)(function* (input: {
  readonly durationMs: number;
  readonly persistenceEnabled: boolean;
}) {
  const service = yield* RelayPersistenceTelemetryService;
  return yield* service.recordEnvironmentCreated(input);
});

export const recordRelayHydration = Effect.fn(
  "RelayPersistenceTelemetryService.access.recordHydration",
)(function* (stats: RelayHydrationStats) {
  const service = yield* RelayPersistenceTelemetryService;
  return yield* service.recordHydration(stats);
});

export const recordRelayRetentionRestore = Effect.fn(
  "RelayPersistenceTelemetryService.access.recordRetentionRestore",
)(function* (stats: OfflineQueryRetentionRestoreStats) {
  const service = yield* RelayPersistenceTelemetryService;
  return yield* service.recordRetentionRestore(stats);
});

export const recordRelayRevalidationFailure = Effect.fn(
  "RelayPersistenceTelemetryService.access.recordRevalidationFailure",
)(function* (input: {
  readonly errorTag: string;
  readonly operationName: string;
}) {
  const service = yield* RelayPersistenceTelemetryService;
  return yield* service.recordRevalidationFailure(input);
});

export const recordRelayRevalidationSweep = Effect.fn(
  "RelayPersistenceTelemetryService.access.recordRevalidationSweep",
)(function* (stats: RevalidationSweepStats) {
  const service = yield* RelayPersistenceTelemetryService;
  return yield* service.recordRevalidationSweep(stats);
});
