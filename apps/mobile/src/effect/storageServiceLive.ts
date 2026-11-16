import { Predicate, Effect, Layer } from "effect";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";
import type { MMKV } from "react-native-mmkv";

import {
  getRuntimeExpoExtraString,
  RuntimeConfigService,
} from "./runtimeConfigService";
import { RuntimeConfigServiceLive } from "./runtimeConfigServiceLive";
import {
  createNativeMMKV,
  createStringStorage,
  makeStorageService,
  MMKVStoreConfig,
  StorageService,
} from "./storageService";

export const StorageServiceLive = Layer.succeed(
  StorageService,
  makeStorageService({
    createMMKV,
    getEncryptionKey: () =>
      Effect.runSync(
        getRuntimeExpoExtraString("MMKV_ENCRYPTION_KEY").pipe(
          Effect.provide(RuntimeConfigServiceLive),
        ),
      ),
    isDevelopment: () => __DEV__,
    supportsEncryption: () => Platform.OS !== "web",
  }),
);

function createServerMMKV(id: string): MMKV {
  const values = new Map<string, boolean | string | number | ArrayBuffer>();
  const listeners = new Set<(key: string) => void>();
  const utf8Encoder = new TextEncoder();

  const getValueByteLength = (
    value: boolean | string | number | ArrayBuffer,
  ) =>
    value instanceof ArrayBuffer
      ? value.byteLength
      : utf8Encoder.encode(String(value)).byteLength;

  const notifyListeners = (key: string) => {
    listeners.forEach((listener) => {
      listener(key);
    });
  };

  const storage: MMKV = {
    id,
    get length() {
      return values.size;
    },
    get size() {
      return this.byteSize;
    },
    get byteSize() {
      let byteSize = 0;

      values.forEach((value, key) => {
        byteSize +=
          utf8Encoder.encode(key).byteLength + getValueByteLength(value);
      });

      return byteSize;
    },
    isReadOnly: false,
    isEncrypted: false,
    name: "MMKV",
    set: (key, value) => {
      if (key === "") {
        throw new Error("Cannot set a value for an empty key");
      }
      values.set(key, value);
      notifyListeners(key);
    },
    getBoolean: (key) => {
      const value = values.get(key);
      return Predicate.isBoolean(value) ? value : undefined;
    },
    getString: (key) => {
      const value = values.get(key);
      return Predicate.isString(value) ? value : undefined;
    },
    getNumber: (key) => {
      const value = values.get(key);
      return Predicate.isNumber(value) ? value : undefined;
    },
    getBuffer: (key) => {
      const value = values.get(key);
      return value instanceof ArrayBuffer ? value : undefined;
    },
    contains: (key) => values.has(key),
    remove: (key) => {
      const removed = values.delete(key);
      if (removed) {
        notifyListeners(key);
      }
      return removed;
    },
    getAllKeys: () => [...values.keys()],
    clearAll: () => {
      const keys = [...values.keys()];
      values.clear();
      keys.forEach(notifyListeners);
    },
    recrypt: () => undefined,
    encrypt: () => undefined,
    decrypt: () => undefined,
    trim: () => undefined,
    checkContentChanged: () => undefined,
    addOnValueChangedListener: (listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
    importAllFrom: (other) => {
      let imported = 0;
      other.getAllKeys().forEach((key) => {
        const value =
          other.getBuffer(key) ??
          other.getString(key) ??
          other.getNumber(key) ??
          other.getBoolean(key);
        if (value !== undefined) {
          values.set(key, value);
          imported += 1;
        }
      });
      return imported;
    },
    dispose: () => undefined,
    equals: (other) => other === storage,
  };

  return storage;
}

function runStorageEffect<A, E>(
  effect: Effect.Effect<A, E, StorageService | RuntimeConfigService>,
): A {
  return Effect.runSync(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(RuntimeConfigServiceLive, StorageServiceLive),
      ),
    ),
  );
}

export function createLiveNativeMMKV(config: MMKVStoreConfig) {
  if (Platform.OS === "web" && typeof window === "undefined") {
    return createServerMMKV(config.id);
  }

  return runStorageEffect(createNativeMMKV(config));
}

export function createLiveStringStorage(
  storage: Parameters<typeof createStringStorage>[0],
) {
  return runStorageEffect(createStringStorage(storage));
}
