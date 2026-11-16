import type { MutableRecordSource, RecordState } from "relay-runtime";
import type { Record as RelayRecord } from "relay-runtime/store/RelayStoreTypes";

const RelayModernRecord = require("relay-runtime/lib/store/RelayModernRecord");

export const RELAY_RECORD_PREFIX = "relay_record:";
export const RELAY_CACHE_VERSION_KEY = "relay_cache_version";
export const RELAY_AUTH_SCOPE_KEY = "relay_auth_scope";
export const RELAY_RETENTION_MANIFEST_KEY = "relay_retention_manifest";
export const DEFAULT_RELAY_RECORD_LIMIT = 5_000;
export const DEFAULT_RELAY_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024;

export type RelayCacheClearReason =
  | "manual"
  | "scope_mismatch"
  | "size_limit"
  | "version_mismatch";

export type RelayHydrationStats = {
  readonly corruptRecordCount: number;
  readonly durationMs: number;
  readonly recordCount: number;
  readonly storageBytes: number;
};

export type RelayStorageAdapter = {
  clearAll(): void;
  getAllKeys(): string[];
  getString(key: string): string | undefined;
  remove(key: string): void;
  readonly size?: number;
  set(key: string, value: string): void;
  trim?(): void;
};

type RecordMap = Record<string, RelayRecord | null>;

export type MMKVRecordSourceOptions = {
  authScope: string;
  cacheVersion: string;
  hardLimits?: {
    readonly maxBytes: number;
    readonly maxRecords: number;
  };
  measureNow?: () => number;
  onCacheCleared?: (reason: RelayCacheClearReason) => void;
  onHydrated?: (stats: RelayHydrationStats) => void;
  storage: RelayStorageAdapter;
};

function getRelayRecordKey(dataID: string): string {
  return `${RELAY_RECORD_PREFIX}${encodeURIComponent(dataID)}`;
}

function getDataIDFromKey(key: string): string {
  return decodeURIComponent(key.slice(RELAY_RECORD_PREFIX.length));
}

function relayRecordToJSON(record: RelayRecord | null): RelayRecord | null {
  return RelayModernRecord.toJSON(record);
}

function relayRecordFromJSON(record: RelayRecord | null): RelayRecord | null {
  return record === null ? null : RelayModernRecord.fromObject(record);
}

export function getPersistedRelayAuthScope(
  storage: RelayStorageAdapter,
): string | null {
  return storage.getString(RELAY_AUTH_SCOPE_KEY) ?? null;
}

export function clearPersistedRelayRecords(
  storage: RelayStorageAdapter,
  scope?: string,
): void {
  const persistedScope = getPersistedRelayAuthScope(storage);
  if (scope && persistedScope && persistedScope !== scope) {
    return;
  }

  let removedRecord = false;
  storage.getAllKeys().forEach((key) => {
    if (
      key.startsWith(RELAY_RECORD_PREFIX) ||
      key === RELAY_CACHE_VERSION_KEY ||
      key === RELAY_AUTH_SCOPE_KEY ||
      key === RELAY_RETENTION_MANIFEST_KEY
    ) {
      storage.remove(key);
      removedRecord = true;
    }
  });

  if (removedRecord) {
    storage.trim?.();
  }
}

function prepareRelayStorageState({
  authScope,
  cacheVersion,
  hardLimits = {
    maxBytes: DEFAULT_RELAY_STORAGE_LIMIT_BYTES,
    maxRecords: DEFAULT_RELAY_RECORD_LIMIT,
  },
  onCacheCleared,
  storage,
}: MMKVRecordSourceOptions): string[] {
  const allKeys = storage.getAllKeys();
  const recordKeys = allKeys.filter((key) =>
    key.startsWith(RELAY_RECORD_PREFIX),
  );
  const storedCacheVersion = storage.getString(RELAY_CACHE_VERSION_KEY) ?? null;
  const storedAuthScope = getPersistedRelayAuthScope(storage);
  const hasPersistedRelayData =
    recordKeys.length > 0 || allKeys.includes(RELAY_RETENTION_MANIFEST_KEY);
  let clearReason: RelayCacheClearReason | null = null;

  if (
    recordKeys.length > hardLimits.maxRecords ||
    (storage.size ?? 0) > hardLimits.maxBytes
  ) {
    clearReason = "size_limit";
  } else if (
    storedCacheVersion !== null &&
    storedCacheVersion !== cacheVersion
  ) {
    clearReason = "version_mismatch";
  } else if (storedAuthScope !== null && storedAuthScope !== authScope) {
    clearReason = "scope_mismatch";
  } else if (
    hasPersistedRelayData &&
    (storedCacheVersion === null || storedAuthScope === null)
  ) {
    clearReason = "version_mismatch";
  }

  if (clearReason !== null) {
    clearPersistedRelayRecords(storage);
    onCacheCleared?.(clearReason);
  }

  storage.set(RELAY_CACHE_VERSION_KEY, cacheVersion);
  storage.set(RELAY_AUTH_SCOPE_KEY, authScope);

  return clearReason === null ? recordKeys : [];
}

function hydrateRecords(
  storage: RelayStorageAdapter,
  recordKeys: readonly string[],
) {
  const records = new Map<string, RelayRecord | null>();
  let corruptRecordCount = 0;

  recordKeys.forEach((key) => {
    const serializedRecord = storage.getString(key);
    if (serializedRecord === undefined) {
      return;
    }

    try {
      const parsed = JSON.parse(serializedRecord);
      records.set(getDataIDFromKey(key), relayRecordFromJSON(parsed));
    } catch {
      corruptRecordCount += 1;
      storage.remove(key);
    }
  });

  return { corruptRecordCount, records };
}

export class MMKVRecordSource implements MutableRecordSource {
  readonly hydrationStats: RelayHydrationStats;
  private readonly records: Map<string, RelayRecord | null>;

  constructor(private readonly options: MMKVRecordSourceOptions) {
    const measureNow =
      options.measureNow ?? (() => globalThis.performance.now());
    const startedAt = measureNow();
    const recordKeys = prepareRelayStorageState(options);
    const { corruptRecordCount, records } = hydrateRecords(
      options.storage,
      recordKeys,
    );

    this.records = records;
    this.hydrationStats = {
      corruptRecordCount,
      durationMs: Math.max(0, measureNow() - startedAt),
      recordCount: records.size,
      storageBytes: options.storage.size ?? 0,
    };
    options.onHydrated?.(this.hydrationStats);
  }

  clear(): void {
    this.records.clear();
    clearPersistedRelayRecords(this.options.storage);
    this.options.onCacheCleared?.("manual");
    prepareRelayStorageState(this.options);
  }

  delete(dataID: string): void {
    this.records.set(dataID, null);
    this.options.storage.set(getRelayRecordKey(dataID), JSON.stringify(null));
  }

  get<T extends object = RelayRecord>(
    dataID: string,
  ): RelayRecord<T> | null | undefined {
    return this.records.get(dataID) as RelayRecord<T> | null | undefined;
  }

  getRecordIDs(): string[] {
    return Array.from(this.records.keys());
  }

  getStatus(dataID: string): RecordState {
    if (!this.records.has(dataID)) {
      return "UNKNOWN";
    }

    return this.records.get(dataID) == null ? "NONEXISTENT" : "EXISTENT";
  }

  has(dataID: string): boolean {
    return this.records.has(dataID);
  }

  remove(dataID: string): void {
    this.records.delete(dataID);
    this.options.storage.remove(getRelayRecordKey(dataID));
  }

  set(dataID: string, record: RelayRecord): void {
    this.records.set(dataID, record);
    this.options.storage.set(
      getRelayRecordKey(dataID),
      JSON.stringify(relayRecordToJSON(record)),
    );
  }

  size(): number {
    return this.records.size;
  }

  toJSON() {
    const records: RecordMap = {};

    this.records.forEach((record, key) => {
      records[key] = relayRecordToJSON(record);
    });

    // Relay serializes deleted records as null, although its public return type omits them.
    return records as ReturnType<MutableRecordSource["toJSON"]>;
  }
}
