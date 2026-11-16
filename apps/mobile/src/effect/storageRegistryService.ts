import { Predicate, Context, Effect } from "effect";

import { StorageClearEntryError } from "@/effect/errors";

export type StorageScope = "user" | "device";
export type StorageSensitivity = "secret" | "state" | "cache";

export type StorageRegistryEntry = {
  readonly clear: () => Promise<void> | void;
  readonly clearOnLogout: boolean;
  readonly id: string;
  readonly purpose: string;
  readonly scope: StorageScope;
  readonly sensitivity: StorageSensitivity;
};

export type StorageRegistryServiceError = StorageClearEntryError;

type StorageRegistryEffect<A> = Effect.Effect<A, StorageRegistryServiceError>;

export type StorageRegistryServiceDependencies = {
  readonly entries: readonly StorageRegistryEntry[];
};

export type StorageRegistryServiceApi = {
  readonly clearAllPersistence: () => StorageRegistryEffect<void>;
  readonly clearUserScopedPersistence: () => StorageRegistryEffect<void>;
  readonly getEntries: () => Effect.Effect<readonly StorageRegistryEntry[]>;
};

export class StorageRegistryService extends Context.Service<
  StorageRegistryService,
  StorageRegistryServiceApi
>()("StorageRegistryService") {}

type RejectedStorageClear = {
  cause: unknown;
  entry: StorageRegistryEntry;
};

function isRejectedStorageClear(cause: unknown): cause is RejectedStorageClear {
  return (
    Predicate.isObjectOrArray(cause) && "entry" in cause && "cause" in cause
  );
}

function makeStorageClearEntryError(cause: unknown): StorageClearEntryError {
  if (isRejectedStorageClear(cause)) {
    return new StorageClearEntryError({
      id: cause.entry.id,
      message: `[storage] Failed to clear persistence entry "${cause.entry.id}".`,
      cause: cause.cause,
    });
  }

  return new StorageClearEntryError({
    id: "unknown",
    message: "[storage] Failed to clear persistence entry.",
    cause,
  });
}

export function makeStorageRegistryService(
  dependencies: StorageRegistryServiceDependencies,
): StorageRegistryServiceApi {
  const clearEntries = (entries: readonly StorageRegistryEntry[]) =>
    Effect.tryPromise({
      try: async () => {
        const results = await Promise.allSettled(
          entries.map(async (entry) => {
            await entry.clear();
          }),
        );

        const rejectedIndex = results.findIndex(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );

        if (rejectedIndex >= 0) {
          const result = results[rejectedIndex];

          if (result.status === "rejected") {
            const error = new Error(
              `[storage] Failed to clear persistence entry "${entries[rejectedIndex].id}".`,
            ) as Error & RejectedStorageClear;
            error.entry = entries[rejectedIndex];
            error.cause = result.reason;
            throw error;
          }
        }
      },
      catch: makeStorageClearEntryError,
    });

  const getEntries = Effect.fn("StorageRegistryService.getEntries")(
    function* () {
      yield* Effect.void;
      return dependencies.entries;
    },
  );

  const clearUserScopedPersistence = Effect.fn(
    "StorageRegistryService.clearUserScopedPersistence",
  )(function* () {
    yield* clearEntries(
      dependencies.entries.filter(
        (entry) => entry.scope === "user" && entry.clearOnLogout,
      ),
    );
  });

  const clearAllPersistence = Effect.fn(
    "StorageRegistryService.clearAllPersistence",
  )(function* () {
    yield* clearEntries(dependencies.entries);
  });

  return {
    clearAllPersistence,
    clearUserScopedPersistence,
    getEntries,
  };
}

export const clearUserScopedStoragePersistence = Effect.fn(
  "StorageRegistryService.access.clearUserScopedPersistence",
)(function* () {
  const service = yield* StorageRegistryService;
  return yield* service.clearUserScopedPersistence();
});

export const clearAllStoragePersistence = Effect.fn(
  "StorageRegistryService.access.clearAllPersistence",
)(function* () {
  const service = yield* StorageRegistryService;
  return yield* service.clearAllPersistence();
});
