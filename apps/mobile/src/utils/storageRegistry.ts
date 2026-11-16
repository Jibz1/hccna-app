import { Effect, Layer } from "effect";

import {
  clearAllStoragePersistence,
  clearUserScopedStoragePersistence,
  makeStorageRegistryService,
  StorageRegistryService,
} from "@/effect/storageRegistryService";
import type { StorageRegistryEntry } from "@/effect/storageRegistryService";
import { clearAuthPersistenceStorage } from "@/utils/authPersistenceStorage";
import { clearDevicePrefs } from "@/utils/devicePrefs";
import {
  atomStorage,
  legacyQueryStorage,
  legacySignalDbStorage,
  pushRegistrationStorage,
  pushLogoutStorage,
  relaySettingsStorage,
  savedVersesStorage,
  statsigStorage,
} from "@/utils/mmkv";
import { clearPushTokens } from "@/utils/pushTokens";
import { clearPersistedRelayStore } from "@/utils/relayPersistence";

export type {
  StorageRegistryEntry,
  StorageScope,
  StorageSensitivity,
} from "@/effect/storageRegistryService";

const USER_SCOPED_SIGNALDB_KEYS = ["giving", "pushTokens", "userData"] as const;

const DEVICE_SCOPED_SIGNALDB_KEYS = [
  "campuses",
  "coreData",
  "devicePrefs",
  "home",
  "preferences",
  "verseOfTheDay",
] as const;

function clearSignalDbCollections(keys: readonly string[]): void {
  keys.forEach((key) => legacySignalDbStorage.remove(key));
}

function clearSignalDbUserScope(): void {
  clearSignalDbCollections(USER_SCOPED_SIGNALDB_KEYS);
}

function clearSignalDbDeviceScope(): void {
  clearSignalDbCollections(DEVICE_SCOPED_SIGNALDB_KEYS);
}

export const storageRegistry: readonly StorageRegistryEntry[] = [
  {
    id: "scripture.bookmarks",
    purpose:
      "Device saves of scripture awaiting their one-time move to the account",
    scope: "user",
    sensitivity: "state",
    clearOnLogout: true,
    clear: () => {
      savedVersesStorage.clearAll();
    },
  },
  {
    id: "device.preferences",
    purpose: "Device-local preferences and transient authentication state",
    scope: "device",
    sensitivity: "state",
    clearOnLogout: false,
    clear: clearDevicePrefs,
  },
  {
    id: "auth.persistence",
    purpose: "Firebase auth session persistence",
    scope: "user",
    sensitivity: "secret",
    clearOnLogout: false,
    clear: clearAuthPersistenceStorage,
  },
  {
    id: "legacy.query.cache",
    purpose: "Legacy TanStack Query persisted cache",
    scope: "user",
    sensitivity: "cache",
    clearOnLogout: true,
    clear: () => {
      legacyQueryStorage.clearAll();
    },
  },
  {
    id: "relay.cache",
    purpose: "Persisted Relay record source",
    scope: "user",
    sensitivity: "cache",
    clearOnLogout: true,
    clear: () => {
      clearPersistedRelayStore();
    },
  },
  {
    id: "push.registration",
    purpose: "Last push-token registration confirmed by the backend",
    scope: "user",
    sensitivity: "secret",
    clearOnLogout: true,
    clear: clearPushTokens,
  },
  {
    id: "push.logout.pending",
    purpose:
      "Device push cleanup capabilities retained until backend acknowledgment",
    scope: "device",
    sensitivity: "secret",
    clearOnLogout: false,
    clear: () => {
      pushLogoutStorage.clearAll();
    },
  },
  {
    id: "push.registration.pending",
    purpose: "Pending replay-safe push-token registration",
    scope: "user",
    sensitivity: "secret",
    clearOnLogout: true,
    clear: () => {
      pushRegistrationStorage.clearAll();
    },
  },
  {
    id: "legacy.signaldb.user",
    purpose: "Legacy user-scoped SignalDB migration data",
    scope: "user",
    sensitivity: "state",
    clearOnLogout: true,
    clear: clearSignalDbUserScope,
  },
  {
    id: "legacy.signaldb.device",
    purpose: "Legacy device-scoped SignalDB migration data",
    scope: "device",
    sensitivity: "state",
    clearOnLogout: false,
    clear: clearSignalDbDeviceScope,
  },
  {
    id: "statsig.bootstrap",
    purpose: "Statsig local bootstrap storage",
    scope: "device",
    sensitivity: "cache",
    clearOnLogout: false,
    clear: () => {
      statsigStorage.clearAll();
    },
  },
  {
    id: "relay.settings",
    purpose: "Relay next-launch rollout settings",
    scope: "device",
    sensitivity: "state",
    clearOnLogout: false,
    clear: () => {
      relaySettingsStorage.clearAll();
    },
  },
  {
    id: "atom.ui",
    purpose: "Persisted Jotai UI state",
    scope: "device",
    sensitivity: "state",
    clearOnLogout: false,
    clear: () => {
      atomStorage.clearAll();
    },
  },
] as const;

const StorageRegistryServiceLive = Layer.succeed(
  StorageRegistryService,
  makeStorageRegistryService({
    entries: storageRegistry,
  }),
);

function runStorageRegistryEffect<A, E>(
  effect: Effect.Effect<A, E, StorageRegistryService>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.provide(StorageRegistryServiceLive)),
  );
}

export async function clearUserScopedPersistence(): Promise<void> {
  await runStorageRegistryEffect(clearUserScopedStoragePersistence());
}

export async function clearAllPersistence(): Promise<void> {
  await runStorageRegistryEffect(clearAllStoragePersistence());
}

export type { AuthPersistenceStorage } from "@/utils/authPersistenceStorage";
