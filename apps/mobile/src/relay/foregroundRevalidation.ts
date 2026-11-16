import { flow, Option, Predicate, Schema } from "effect";
import type { ConcreteRequest, Variables } from "relay-runtime";

import type { ConnectivityStatus } from "@/effect/connectivity";
import { DYNAMIC_CONFIGS } from "@/featureGates/names";
import {
  retentionEntryKey,
  type OfflineQueryRetentionAllowlist,
  type OfflineQueryRetentionEntry,
} from "@/relay/offlineQueryRetention";

export const RELAY_REVALIDATION_CONFIG_NAME = DYNAMIC_CONFIGS.relayRevalidation;
export const RELAY_REVALIDATION_LAST_GENERATION_KEY =
  "relay_revalidation_last_generation";
export const DEFAULT_REVALIDATION_WINDOW_MS = 5 * 60 * 1_000;
// Revalidating sermons refetches only the first page, dropping pages loaded by
// scrolling, so a quick trip to the video player must not trigger it.
const SERMONS_REVALIDATION_WINDOW_MS = 60 * 60 * 1_000;
export const REVALIDATION_SWEEP_COOLDOWN_MS = 15 * 1_000;
export const REVALIDATION_FETCH_TIMEOUT_MS = 30 * 1_000;
export const REVALIDATION_FETCH_START_DELAY_MS = 200;

export type RevalidationConfig = {
  readonly cacheGeneration: number | null;
  readonly defaultWindowMs: number;
  readonly windows: Readonly<Record<string, number>>;
};

// Windows accept 0: `{"windows": {"FeaturedEventsQuery": 0}}` is the natural ops idiom
// for "revalidate this query on every sweep".
function isNonNegativeFiniteNumber(value: unknown): value is number {
  return Predicate.isNumber(value) && Number.isFinite(value) && value >= 0;
}

const RevalidationConfigInput = Schema.Struct({
  cacheGeneration: Schema.optional(Schema.Unknown),
  defaultWindowMs: Schema.optional(Schema.Unknown),
  windows: Schema.optional(Schema.Unknown),
});

export const parseRevalidationConfig = flow(
  Schema.decodeUnknownOption(RevalidationConfigInput),
  Option.getOrElse(() => RevalidationConfigInput.make({})),
  (record): RevalidationConfig => {
    const windows: Record<string, number> = {};
    if (
      Predicate.isObjectOrArray(record.windows) &&
      !Array.isArray(record.windows)
    ) {
      for (const [operationName, windowMs] of Object.entries(record.windows)) {
        if (isNonNegativeFiniteNumber(windowMs)) {
          windows[operationName] = windowMs;
        }
      }
    }

    return {
      cacheGeneration:
        Predicate.isNumber(record.cacheGeneration) &&
        Number.isFinite(record.cacheGeneration)
          ? record.cacheGeneration
          : null,
      defaultWindowMs: isNonNegativeFiniteNumber(record.defaultWindowMs)
        ? record.defaultWindowMs
        : DEFAULT_REVALIDATION_WINDOW_MS,
      windows: {
        FeaturedEventsQuery: 0,
        SermonsContainerQuery: SERMONS_REVALIDATION_WINDOW_MS,
        ...windows,
      },
    };
  },
);

export type RevalidationTrigger = "connectivity_restored" | "foregrounded";

export type RevalidationSweepStats = {
  readonly checked: number;
  readonly failed: number;
  readonly generationBump: boolean;
  readonly refetched: number;
  readonly skippedFresh: number;
  readonly trigger: RevalidationTrigger;
};

export type RevalidationGenerationStorage = {
  readonly getString: (key: string) => string | undefined;
  readonly set: (key: string, value: string) => void;
};

export type ForegroundRevalidatorOptions = {
  readonly allowlist: OfflineQueryRetentionAllowlist;
  readonly executeFetch: (
    request: ConcreteRequest,
    variables: Variables,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly fetchStartDelayMs?: number;
  readonly generationStorage: RevalidationGenerationStorage;
  readonly getConfig: () => RevalidationConfig;
  readonly getConnectivityStatus: () => ConnectivityStatus;
  readonly now: () => number;
  readonly onRevalidationFailure?: (
    operationName: string,
    cause: unknown,
  ) => void;
  readonly onSweepCompleted?: (stats: RevalidationSweepStats) => void;
};

type FetchRecord = {
  readonly at: number;
  readonly operationName: string;
  readonly variables: Variables;
};

type GenerationDecision = {
  readonly generationBump: boolean;
  /** Set only when a bump was detected and is not yet durably persisted. */
  readonly pendingGeneration: number | null;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ForegroundRevalidator {
  private readonly activeFetches = new Set<AbortController>();
  private disposed = false;
  private readonly lastFetched = new Map<string, FetchRecord>();
  private lastSweepAt: number | null = null;
  private sweeping = false;

  constructor(private readonly options: ForegroundRevalidatorOptions) {}

  seedFromManifestEntries(
    entries: readonly OfflineQueryRetentionEntry[],
  ): void {
    entries.forEach((entry) => {
      if (this.options.allowlist[entry.operationName] === undefined) {
        return;
      }

      this.lastFetched.set(
        retentionEntryKey(entry.operationName, entry.variables),
        {
          at: entry.lastAccessedAt,
          operationName: entry.operationName,
          variables: entry.variables,
        },
      );
    });
  }

  recordSuccessfulFetch(operationName: string, variables: Variables): void {
    if (this.disposed || this.options.allowlist[operationName] === undefined) {
      return;
    }

    // No per-operation variant cap here: every current allowlist query takes
    // zero variables. Revisit this map if a variable-taking query joins the
    // allowlist.
    this.lastFetched.set(retentionEntryKey(operationName, variables), {
      at: this.options.now(),
      operationName,
      variables,
    });
  }

  async sweep(
    trigger: RevalidationTrigger,
  ): Promise<RevalidationSweepStats | null> {
    if (this.disposed || this.sweeping) {
      return null;
    }

    const sweepStartedAt = this.options.now();
    if (
      this.lastSweepAt !== null &&
      sweepStartedAt - this.lastSweepAt < REVALIDATION_SWEEP_COOLDOWN_MS
    ) {
      return null;
    }

    if (this.options.getConnectivityStatus() === "offline") {
      return null;
    }

    const config = this.options.getConfig();
    const { generationBump, pendingGeneration } = this.readGeneration(
      config.cacheGeneration,
    );
    this.lastSweepAt = sweepStartedAt;
    this.sweeping = true;

    let failed = 0;
    let refetched = 0;
    // Snapshot: successful fetches re-stamp entries mid-sweep.
    const entries = [...this.lastFetched.values()];
    const allowlistOrder = new Map(
      Object.keys(this.options.allowlist).map((operationName, index) => [
        operationName,
        index,
      ]),
    );
    const due: {
      entry: FetchRecord;
      request: ConcreteRequest;
      sequence: number;
    }[] = [];

    for (const [sequence, entry] of entries.entries()) {
      const policy = this.options.allowlist[entry.operationName];
      if (policy === undefined) {
        continue;
      }

      const windowMs =
        config.windows[entry.operationName] ?? config.defaultWindowMs;
      // A window of 0 makes any entry stamped in the past due immediately.
      if (!generationBump && sweepStartedAt - entry.at <= windowMs) {
        continue;
      }

      due.push({ entry, request: policy.request, sequence });
    }

    due.sort((left, right) => {
      const leftOrder =
        allowlistOrder.get(left.entry.operationName) ?? Infinity;
      const rightOrder =
        allowlistOrder.get(right.entry.operationName) ?? Infinity;
      return leftOrder - rightOrder || left.sequence - right.sequence;
    });

    const skippedFresh = entries.length - due.length;
    const fetchStartDelayMs =
      this.options.fetchStartDelayMs ?? REVALIDATION_FETCH_START_DELAY_MS;

    try {
      // Concurrent: a serial loop let one flaky entry hold `sweeping` for the
      // full timeout budget times the entry count, dropping every trigger in
      // between. Wall clock is now bounded by a single timeout window.
      const fetches: Promise<void>[] = [];
      let nextStart = Promise.resolve();
      for (const [index, { entry, request }] of due.entries()) {
        if (index === 0 || fetchStartDelayMs <= 0) {
          fetches.push(this.executeFetchWithTimeout(request, entry.variables));
          continue;
        }

        nextStart = nextStart.then(() => delay(fetchStartDelayMs));
        fetches.push(
          nextStart.then(() => {
            if (this.disposed) {
              throw new Error("Revalidation fetch aborted");
            }

            return this.executeFetchWithTimeout(request, entry.variables);
          }),
        );
      }
      const results = await Promise.allSettled(fetches);

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          refetched += 1;
          return;
        }

        failed += 1;
        const operationName = due[index]?.entry.operationName;
        if (operationName !== undefined) {
          this.options.onRevalidationFailure?.(operationName, result.reason);
        }
      });
    } finally {
      this.sweeping = false;
    }

    // Persist the bump only once the whole sweep succeeded. Trading a
    // possible duplicate fetch on the next sweep for the guarantee that a
    // partially-failed (or disposed) sweep never consumes the generation.
    if (pendingGeneration !== null && !this.disposed && failed === 0) {
      this.options.generationStorage.set(
        RELAY_REVALIDATION_LAST_GENERATION_KEY,
        String(pendingGeneration),
      );
    }

    const stats: RevalidationSweepStats = {
      checked: entries.length,
      failed,
      generationBump,
      refetched,
      skippedFresh,
      trigger,
    };
    this.options.onSweepCompleted?.(stats);
    return stats;
  }

  dispose(): void {
    this.disposed = true;
    this.lastFetched.clear();
    this.activeFetches.forEach((controller) => {
      controller.abort();
    });
    this.activeFetches.clear();
  }

  private executeFetchWithTimeout(
    request: ConcreteRequest,
    variables: Variables,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    this.activeFetches.add(controller);
    const fetchPromise = this.options.executeFetch(
      request,
      variables,
      controller.signal,
    );
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Cancel the underlying request: an orphaned fetch's write-through can
        // land long after the environment moved to another auth scope.
        controller.abort();
        reject(new Error("Revalidation fetch timed out"));
      }, REVALIDATION_FETCH_TIMEOUT_MS);
    });

    return Promise.race([fetchPromise, timeoutPromise]).finally(() => {
      clearTimeout(timer);
      this.activeFetches.delete(controller);
    });
  }

  private readGeneration(cacheGeneration: number | null): GenerationDecision {
    const noBump: GenerationDecision = {
      generationBump: false,
      pendingGeneration: null,
    };

    if (cacheGeneration === null) {
      return noBump;
    }

    const stored = this.options.generationStorage.getString(
      RELAY_REVALIDATION_LAST_GENERATION_KEY,
    );
    if (stored === undefined) {
      // First observation adopts the generation without forcing a sweep, so
      // fresh installs don't refetch data they just loaded. Adoption is not a
      // bump, so it is safe to persist immediately.
      this.options.generationStorage.set(
        RELAY_REVALIDATION_LAST_GENERATION_KEY,
        String(cacheGeneration),
      );
      return noBump;
    }

    if (Number(stored) === cacheGeneration) {
      return noBump;
    }

    return { generationBump: true, pendingGeneration: cacheGeneration };
  }
}
