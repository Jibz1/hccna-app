import { Predicate, Result, Schema } from "effect";
import {
  createOperationDescriptor,
  type ConcreteRequest,
  type Disposable,
  type Store,
  type Variables,
} from "relay-runtime";

import LatestEventsQueryNode from "@/components/events/__generated__/LatestEventsQuery.graphql";
import SavedVersesQueryNode from "@/components/saved-verses/__generated__/SavedVersesQuery.graphql";
import SermonsContainerQueryNode from "@/components/sermons/__generated__/SermonsContainerQuery.graphql";
import CampusesQueryNode from "@/hooks/relay/__generated__/CampusesQuery.graphql";
import CoreDataQueryNode from "@/hooks/relay/__generated__/CoreDataQuery.graphql";
import FeaturedEventsQueryNode from "@/hooks/relay/__generated__/FeaturedEventsQuery.graphql";
import UserProfileQueryNode from "@/hooks/relay/__generated__/UserProfileQuery.graphql";
import UserWoaQueryNode from "@/hooks/relay/__generated__/UserWoaQuery.graphql";
import VerseOfTheDayQueryNode from "@/hooks/relay/__generated__/VerseOfTheDayQuery.graphql";
import {
  RELAY_RETENTION_MANIFEST_KEY,
  type RelayStorageAdapter,
} from "@/utils/relayRecordSource";

const RETENTION_MANIFEST_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1_000;

const RetentionEntrySchema = Schema.Struct({
  operationName: Schema.String,
  variables: Schema.Record(Schema.String, Schema.Unknown),
  authScope: Schema.String,
  lastAccessedAt: Schema.Number,
  // Advisory only: restore renders stale data and store-and-network
  // refreshes it (see 2026-08-04 relay-persistence-default-on spec).
  expiresAt: Schema.Number,
});

const RetentionManifestSchema = Schema.Struct({
  version: Schema.Literal(RETENTION_MANIFEST_VERSION),
  entries: Schema.Array(RetentionEntrySchema),
});

const RetentionManifestJsonSchema = Schema.fromJsonString(
  RetentionManifestSchema,
);
const decodeRetentionManifest = Schema.decodeUnknownResult(
  RetentionManifestJsonSchema,
);
const encodeRetentionManifest = Schema.encodeUnknownResult(
  RetentionManifestJsonSchema,
);

export type OfflineQueryRetentionEntry = typeof RetentionEntrySchema.Type;

export type OfflineQueryRetentionPolicy = {
  readonly maxVariants: number;
  readonly request: ConcreteRequest;
  readonly ttlMs: number;
};

export type OfflineQueryRetentionAllowlist = Readonly<
  Record<string, OfflineQueryRetentionPolicy>
>;

export type OfflineQueryRetentionDiscardReason =
  | "expired"
  | "malformed"
  | "missing_records"
  | "unknown_operation"
  | "variant_limit"
  | "wrong_scope";

export type OfflineQueryRetentionRestoreStats = {
  readonly discarded: Readonly<
    Record<OfflineQueryRetentionDiscardReason, number>
  >;
  readonly retainedCount: number;
};

type RetentionStore = Pick<Store, "check" | "retain">;

export type OfflineQueryRetentionRegistryOptions = {
  readonly allowlist?: OfflineQueryRetentionAllowlist;
  readonly authScope: string;
  readonly gcHold: Disposable;
  readonly now: () => number;
  readonly onRestored?: (stats: OfflineQueryRetentionRestoreStats) => void;
  readonly storage: RelayStorageAdapter;
  readonly store: RetentionStore;
};

export const DEFAULT_OFFLINE_QUERY_RETENTION_ALLOWLIST = {
  VerseOfTheDayQuery: {
    maxVariants: 1,
    request: VerseOfTheDayQueryNode,
    ttlMs: 7 * DAY_MS,
  },
  CampusesQuery: {
    maxVariants: 2,
    request: CampusesQueryNode,
    ttlMs: 30 * DAY_MS,
  },
  CoreDataQuery: {
    maxVariants: 1,
    request: CoreDataQueryNode,
    ttlMs: 30 * DAY_MS,
  },
  FeaturedEventsQuery: {
    maxVariants: 2,
    request: FeaturedEventsQueryNode,
    ttlMs: 7 * DAY_MS,
  },
  LatestEventsQuery: {
    maxVariants: 1,
    request: LatestEventsQueryNode,
    ttlMs: 7 * DAY_MS,
  },
  // Revalidation refetches the first page, replacing pages loaded by scrolling;
  // foregroundRevalidation.ts gives it a longer default window.
  SermonsContainerQuery: {
    maxVariants: 1,
    request: SermonsContainerQueryNode,
    ttlMs: 7 * DAY_MS,
  },
  UserProfileQuery: {
    maxVariants: 1,
    request: UserProfileQueryNode,
    ttlMs: 7 * DAY_MS,
  },
  UserWoaQuery: {
    maxVariants: 1,
    request: UserWoaQueryNode,
    ttlMs: 7 * DAY_MS,
  },
  // Saved verses promise offline reading, so keep them as long as other reference data.
  SavedVersesQuery: {
    maxVariants: 1,
    request: SavedVersesQueryNode,
    ttlMs: 30 * DAY_MS,
  },
} satisfies OfflineQueryRetentionAllowlist;

function emptyDiscardCounts(): Record<
  OfflineQueryRetentionDiscardReason,
  number
> {
  return {
    expired: 0,
    malformed: 0,
    missing_records: 0,
    unknown_operation: 0,
    variant_limit: 0,
    wrong_scope: 0,
  };
}

type QueryVariableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly QueryVariableValue[]
  | { readonly [name: string]: QueryVariableValue };

function stableSerialize(value: QueryVariableValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (Predicate.isObjectOrArray(value)) {
    const entries = Object.entries<QueryVariableValue>(value).sort(
      ([left], [right]) => left.localeCompare(right),
    );

    return `{${entries
      .map(
        ([key, nestedValue]) =>
          `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

export function retentionEntryKey(
  operationName: string,
  variables: Variables,
): string {
  return `${operationName}:${stableSerialize(variables)}`;
}

export class OfflineQueryRetentionRegistry {
  private readonly allowlist: OfflineQueryRetentionAllowlist;
  private readonly retained = new Map<string, Disposable>();
  private disposed = false;
  private entries: OfflineQueryRetentionEntry[] = [];
  private restored = false;

  constructor(private readonly options: OfflineQueryRetentionRegistryOptions) {
    this.allowlist =
      options.allowlist ?? DEFAULT_OFFLINE_QUERY_RETENTION_ALLOWLIST;
  }

  restore(): OfflineQueryRetentionRestoreStats {
    if (this.restored) {
      return {
        discarded: emptyDiscardCounts(),
        retainedCount: this.retained.size,
      };
    }

    this.restored = true;
    const discarded = emptyDiscardCounts();
    let stats: OfflineQueryRetentionRestoreStats = {
      discarded,
      retainedCount: 0,
    };

    try {
      const serializedManifest = this.options.storage.getString(
        RELAY_RETENTION_MANIFEST_KEY,
      );

      if (serializedManifest === undefined) {
        return stats;
      }

      const decoded = decodeRetentionManifest(serializedManifest);
      if (!Result.isSuccess(decoded)) {
        discarded.malformed += 1;
        this.options.storage.remove(RELAY_RETENTION_MANIFEST_KEY);
        return stats;
      }

      const variantsByOperation = new Map<string, number>();
      const restoredEntries: OfflineQueryRetentionEntry[] = [];
      const entries = [...decoded.success.entries].sort(
        (left, right) => right.lastAccessedAt - left.lastAccessedAt,
      );

      for (const entry of entries) {
        const policy = this.allowlist[entry.operationName];

        if (policy === undefined) {
          discarded.unknown_operation += 1;
          continue;
        }

        if (entry.authScope !== this.options.authScope) {
          discarded.wrong_scope += 1;
          continue;
        }

        const variantCount = variantsByOperation.get(entry.operationName) ?? 0;
        const key = retentionEntryKey(entry.operationName, entry.variables);
        if (this.retained.has(key)) {
          discarded.malformed += 1;
          continue;
        }

        if (variantCount >= policy.maxVariants) {
          discarded.variant_limit += 1;
          continue;
        }

        try {
          const operation = createOperationDescriptor(
            policy.request,
            entry.variables,
          );
          if (this.options.store.check(operation).status !== "available") {
            discarded.missing_records += 1;
            continue;
          }

          this.retained.set(key, this.options.store.retain(operation));
        } catch {
          discarded.malformed += 1;
          continue;
        }

        restoredEntries.push(entry);
        variantsByOperation.set(entry.operationName, variantCount + 1);
      }

      this.entries = restoredEntries;
      stats = {
        discarded,
        retainedCount: restoredEntries.length,
      };
      this.persistManifest();

      return stats;
    } finally {
      this.options.gcHold.dispose();
      this.options.onRestored?.(stats);
    }
  }

  recordSuccessfulQuery(operationName: string, variables: Variables): boolean {
    if (this.disposed) {
      return false;
    }

    const policy = this.allowlist[operationName];
    if (policy === undefined) {
      return false;
    }

    const operation = createOperationDescriptor(policy.request, variables);
    if (this.options.store.check(operation).status !== "available") {
      return false;
    }

    const now = this.options.now();
    const key = retentionEntryKey(operationName, variables);
    const nextEntry: OfflineQueryRetentionEntry = {
      operationName,
      variables,
      authScope: this.options.authScope,
      lastAccessedAt: now,
      expiresAt: now + policy.ttlMs,
    };
    const existingEntryIndex = this.entries.findIndex(
      (entry) =>
        retentionEntryKey(entry.operationName, entry.variables) === key,
    );

    if (existingEntryIndex === -1) {
      this.entries.push(nextEntry);
      this.retained.set(key, this.options.store.retain(operation));
    } else {
      this.entries[existingEntryIndex] = nextEntry;
    }

    const operationEntries = this.entries
      .filter((entry) => entry.operationName === operationName)
      .sort((left, right) => right.lastAccessedAt - left.lastAccessedAt);
    const retainedOperationKeys = new Set(
      operationEntries
        .slice(0, policy.maxVariants)
        .map((entry) =>
          retentionEntryKey(entry.operationName, entry.variables),
        ),
    );

    this.entries = this.entries.filter((entry) => {
      if (entry.operationName !== operationName) {
        return true;
      }

      const candidateKey = retentionEntryKey(
        entry.operationName,
        entry.variables,
      );
      if (retainedOperationKeys.has(candidateKey)) {
        return true;
      }

      this.retained.get(candidateKey)?.dispose();
      this.retained.delete(candidateKey);
      return false;
    });

    this.persistManifest();
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.retained.forEach((retainedOperation) => {
      retainedOperation.dispose();
    });
    this.retained.clear();

    if (!this.restored) {
      this.restored = true;
      this.options.gcHold.dispose();
    }
  }

  getEntries(): readonly OfflineQueryRetentionEntry[] {
    return this.entries;
  }

  private persistManifest(): void {
    if (this.entries.length === 0) {
      this.options.storage.remove(RELAY_RETENTION_MANIFEST_KEY);
      return;
    }

    const encoded = encodeRetentionManifest({
      version: RETENTION_MANIFEST_VERSION,
      entries: this.entries,
    });

    if (Result.isSuccess(encoded)) {
      this.options.storage.set(RELAY_RETENTION_MANIFEST_KEY, encoded.success);
      return;
    }

    this.options.storage.remove(RELAY_RETENTION_MANIFEST_KEY);
  }
}
