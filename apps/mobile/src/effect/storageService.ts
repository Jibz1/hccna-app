import { Context, Effect } from "effect";
import type { MMKV } from "react-native-mmkv";

import { StorageEncryptionKeyMissingError } from "@/effect/errors";

export type MMKVStoreConfig = {
  readonly id: string;
  readonly requiresEncryption?: boolean;
};

type StringStorage = Pick<MMKV, "getString" | "remove" | "set">;

export type ClientStorage = {
  readonly getItem: (key: string) => string | null;
  readonly removeItem: (key: string) => void;
  readonly setItem: (key: string, value: string) => void;
};

export type StorageServiceError = StorageEncryptionKeyMissingError;

type StorageEffect<A> = Effect.Effect<A, StorageServiceError>;

export type StorageServiceDependencies = {
  readonly createMMKV: (config: { id: string; encryptionKey?: string }) => MMKV;
  readonly getEncryptionKey: () => string | undefined;
  readonly isDevelopment: () => boolean;
  readonly supportsEncryption: () => boolean;
};

export type StorageServiceApi = {
  readonly createNativeMMKV: (config: MMKVStoreConfig) => StorageEffect<MMKV>;
  readonly createStringStorage: (
    storage: StringStorage,
  ) => Effect.Effect<ClientStorage>;
};

export class StorageService extends Context.Service<
  StorageService,
  StorageServiceApi
>()("StorageService") {}

export function makeStorageService(
  dependencies: StorageServiceDependencies,
): StorageServiceApi {
  const createNativeMMKV = Effect.fn("StorageService.createNativeMMKV")(
    function* ({ id, requiresEncryption = false }: MMKVStoreConfig) {
      const shouldEncrypt =
        requiresEncryption && dependencies.supportsEncryption();

      if (!shouldEncrypt) {
        return dependencies.createMMKV({ id });
      }

      const encryptionKey = dependencies.getEncryptionKey();

      if (!encryptionKey && !dependencies.isDevelopment()) {
        return yield* new StorageEncryptionKeyMissingError({
          id,
          message: `[storage] Missing MMKV encryption key for store "${id}". Configure extra.MMKV_ENCRYPTION_KEY before shipping a production build.`,
        });
      }

      return dependencies.createMMKV(
        requiresEncryption && encryptionKey
          ? {
              id,
              encryptionKey,
            }
          : { id },
      );
    },
  );

  const createStringStorage = Effect.fn("StorageService.createStringStorage")(
    function* (storage: StringStorage) {
      yield* Effect.void;

      return {
        getItem: (key: string) => storage.getString(key) ?? null,
        removeItem: (key: string) => storage.remove(key),
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      };
    },
  );

  return {
    createNativeMMKV,
    createStringStorage,
  };
}

export const createNativeMMKV = Effect.fn(
  "StorageService.access.createNativeMMKV",
)(function* (config: MMKVStoreConfig) {
  const service = yield* StorageService;
  return yield* service.createNativeMMKV(config);
});

export const createStringStorage = Effect.fn(
  "StorageService.access.createStringStorage",
)(function* (storage: StringStorage) {
  const service = yield* StorageService;
  return yield* service.createStringStorage(storage);
});
