import * as SecureStore from "expo-secure-store";

const AUTH_PERSISTENCE_NAMESPACE = "hccna.auth.persistence";
const AUTH_PERSISTENCE_INDEX_KEY = `${AUTH_PERSISTENCE_NAMESPACE}.__keys__`;
let trackedKeysMutation = Promise.resolve();

export interface AuthPersistenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function getStorageKey(key: string): string {
  return `${AUTH_PERSISTENCE_NAMESPACE}.${key}`;
}

async function readTrackedKeys(): Promise<string[]> {
  const rawValue = await SecureStore.getItemAsync(AUTH_PERSISTENCE_INDEX_KEY);

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await SecureStore.deleteItemAsync(AUTH_PERSISTENCE_INDEX_KEY);
    return [];
  }
}

async function writeTrackedKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) {
    await SecureStore.deleteItemAsync(AUTH_PERSISTENCE_INDEX_KEY);
    return;
  }

  await SecureStore.setItemAsync(
    AUTH_PERSISTENCE_INDEX_KEY,
    JSON.stringify(keys),
  );
}

async function mutateTrackedKeys(
  update: (keys: string[]) => string[],
): Promise<void> {
  const mutation = trackedKeysMutation.then(async () => {
    const nextKeys = update(await readTrackedKeys());
    await writeTrackedKeys(nextKeys);
  });

  trackedKeysMutation = mutation;

  await mutation;
}

async function trackKey(key: string): Promise<void> {
  await mutateTrackedKeys((keys) =>
    keys.includes(key) ? keys : [...keys, key],
  );
}

async function untrackKey(key: string): Promise<void> {
  await mutateTrackedKeys((keys) =>
    keys.filter((trackedKey) => trackedKey !== key),
  );
}

export const firebaseAuthPersistenceStorage: AuthPersistenceStorage = {
  async getItem(key) {
    return await SecureStore.getItemAsync(getStorageKey(key));
  },
  async setItem(key, value) {
    await SecureStore.setItemAsync(getStorageKey(key), value);
    await trackKey(key);
  },
  async removeItem(key) {
    await SecureStore.deleteItemAsync(getStorageKey(key));
    await untrackKey(key);
  },
};

export async function clearAuthPersistenceStorage(): Promise<void> {
  const keys = await readTrackedKeys();

  await Promise.all(
    keys.map((key) => SecureStore.deleteItemAsync(getStorageKey(key))),
  );
  await SecureStore.deleteItemAsync(AUTH_PERSISTENCE_INDEX_KEY);
}
