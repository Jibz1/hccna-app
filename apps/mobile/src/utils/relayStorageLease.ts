import type { RelayStorageAdapter } from "@/utils/relayRecordSource";

const owners = new WeakMap<RelayStorageAdapter, object>();

/** A lease cannot become active again, even when the same account returns. */
export function acquireRelayStorage(storage: RelayStorageAdapter) {
  const owner = {};
  owners.set(storage, owner);
  const isActive = () => owners.get(storage) === owner;

  return {
    storage: {
      clearAll: () => {
        if (isActive()) {
          storage.clearAll();
        }
      },
      getAllKeys: () => (isActive() ? storage.getAllKeys() : []),
      getString: (key: string) =>
        isActive() ? storage.getString(key) : undefined,
      remove: (key: string) => {
        if (isActive()) {
          storage.remove(key);
        }
      },
      get size() {
        return isActive() ? storage.size : 0;
      },
      set: (key: string, value: string) => {
        if (isActive()) {
          storage.set(key, value);
        }
      },
      trim: () => {
        if (isActive()) {
          storage.trim?.();
        }
      },
    } satisfies RelayStorageAdapter,
    dispose: () => {
      if (isActive()) {
        owners.delete(storage);
      }
    },
  };
}
