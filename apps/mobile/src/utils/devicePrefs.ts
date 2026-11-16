import { flow, Option, Predicate, Schema } from "effect";
import { nativeApplicationVersion } from "expo-application";
import * as ExpoCrypto from "expo-crypto";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { devicePrefsStorage, legacySignalDbStorage } from "@/utils/mmkv";

import {
  DEFAULT_THEME,
  DevicePrefsSchema,
  type DevicePrefsDoc,
  type DynamicTheme,
  LATEST_DEVICE_PREFS_VERSION,
} from "./devicePrefsSchema";

const DEVICE_PREFS_KEY = "devicePrefs";
const LEGACY_DEVICE_PREFS_KEYS = ["devicePrefs", "preferences"] as const;
const SERVER_DEVICE_PREFS_SNAPSHOT: DevicePrefsDoc = {
  id: "00000000-0000-4000-8000-000000000000",
  createdAt: new Date(0),
  version: LATEST_DEVICE_PREFS_VERSION,
  theme: DEFAULT_THEME,
  soundEnabled: true,
  wasAuthenticated: false,
};

type DevicePrefsListener = () => void;

function isServerRenderingWeb(): boolean {
  return Platform.OS === "web" && typeof window === "undefined";
}

function getServerDevicePrefsSnapshot(): DevicePrefsDoc {
  return SERVER_DEVICE_PREFS_SNAPSHOT;
}

const decodeDevicePrefs = flow(
  Schema.decodeUnknownOption(DevicePrefsSchema),
  Option.getOrNull,
);

function parseDevicePrefs(value: string | undefined): DevicePrefsDoc | null {
  if (!value) {
    return null;
  }

  try {
    return decodeDevicePrefs(JSON.parse(value));
  } catch {
    return null;
  }
}

function readLegacyDevicePrefs(): DevicePrefsDoc | null {
  for (const key of LEGACY_DEVICE_PREFS_KEYS) {
    const serialized = legacySignalDbStorage.getString(key);
    if (!serialized) {
      continue;
    }

    try {
      const items: unknown = JSON.parse(serialized);
      if (!Array.isArray(items)) {
        continue;
      }

      for (const item of items) {
        if (!Predicate.isObject(item)) {
          continue;
        }
        const decoded = decodeDevicePrefs({
          ...item,
          wasAuthenticated:
            "wasAuthenticated" in item ? item.wasAuthenticated : false,
        });

        if (decoded) {
          return decoded;
        }
      }
    } catch {
      // A malformed legacy cache should not prevent the app from starting.
    }
  }

  return null;
}

function readLegacyPreferredCampus(): string | undefined {
  const serialized = legacySignalDbStorage.getString("userData");
  if (!serialized) {
    return undefined;
  }

  try {
    const items: unknown = JSON.parse(serialized);
    if (!Array.isArray(items)) {
      return undefined;
    }

    for (const item of items) {
      if (
        Predicate.isObjectOrArray(item) &&
        "preferences" in item &&
        Predicate.isObjectOrArray(item.preferences) &&
        "preferredCampusId" in item.preferences &&
        Predicate.isString(item.preferences.preferredCampusId)
      ) {
        return item.preferences.preferredCampusId;
      }
    }
  } catch {
    // A malformed legacy cache should not block preference initialization.
  }

  return undefined;
}

function migrateDevicePrefs(preferences: DevicePrefsDoc): DevicePrefsDoc {
  if ((preferences.version ?? 0) >= LATEST_DEVICE_PREFS_VERSION) {
    return preferences;
  }

  return (
    decodeDevicePrefs({
      ...preferences,
      campusLocationId:
        preferences.campusLocationId ?? readLegacyPreferredCampus(),
      version: LATEST_DEVICE_PREFS_VERSION,
    }) ?? preferences
  );
}

function createDefaultDevicePrefs(): DevicePrefsDoc {
  return {
    id: ExpoCrypto.randomUUID(),
    createdAt: new Date(),
    version: LATEST_DEVICE_PREFS_VERSION,
    theme: DEFAULT_THEME,
    soundEnabled: true,
    wasAuthenticated: false,
    // Fresh installs start at this version. Existing preferences without this
    // field remain eligible for the first release with in-app notes.
    whatsNewLastSeenVersion: nativeApplicationVersion,
  };
}

function loadDevicePrefs(): DevicePrefsDoc {
  if (isServerRenderingWeb()) {
    return getServerDevicePrefsSnapshot();
  }

  const persisted = parseDevicePrefs(
    devicePrefsStorage.getString(DEVICE_PREFS_KEY),
  );
  if (persisted) {
    const migrated = migrateDevicePrefs(persisted);
    if (migrated !== persisted) {
      devicePrefsStorage.set(DEVICE_PREFS_KEY, JSON.stringify(migrated));
    }
    return migrated;
  }

  const migrated = readLegacyDevicePrefs();
  const initial = migrated ?? createDefaultDevicePrefs();
  const current = migrateDevicePrefs(initial);
  devicePrefsStorage.set(DEVICE_PREFS_KEY, JSON.stringify(current));
  return current;
}

class DevicePrefsStore {
  readonly #listeners = new Set<DevicePrefsListener>();
  #snapshot = loadDevicePrefs();

  readonly getSnapshot = (): DevicePrefsDoc => this.#snapshot;

  readonly subscribe = (listener: DevicePrefsListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  ensure(): DevicePrefsDoc {
    return this.#snapshot;
  }

  update(updates: Partial<DevicePrefsDoc>): DevicePrefsDoc {
    const next = decodeDevicePrefs({
      ...this.#snapshot,
      ...updates,
    });

    if (!next) {
      throw new Error("[DevicePrefs] Refusing to persist invalid preferences");
    }

    this.#snapshot = next;
    if (!isServerRenderingWeb()) {
      devicePrefsStorage.set(DEVICE_PREFS_KEY, JSON.stringify(next));
    }
    this.#listeners.forEach((listener) => {
      listener();
    });
    return next;
  }

  getTheme(): DynamicTheme {
    return this.#snapshot.theme ?? DEFAULT_THEME;
  }

  setTheme(theme: DevicePrefsDoc["theme"]) {
    this.update({ theme });
  }

  isSoundEnabled(): boolean {
    return this.#snapshot.soundEnabled ?? true;
  }

  setSoundEnabled(enabled: boolean) {
    this.update({ soundEnabled: enabled });
  }

  getSignInWithCodeEmail(): DevicePrefsDoc["signInWithCodeEmail"] {
    return this.#snapshot.signInWithCodeEmail;
  }

  setSignInWithCodeEmail(data: DevicePrefsDoc["signInWithCodeEmail"]) {
    this.update({ signInWithCodeEmail: data });
  }

  clearSignInWithCodeEmail() {
    this.update({ signInWithCodeEmail: null });
  }

  getOptInFeatures(): string[] {
    return [...(this.#snapshot.optInFeatures ?? [])];
  }

  addOptInFeature(feature: string) {
    const currentFeatures = this.getOptInFeatures();
    if (!currentFeatures.includes(feature)) {
      this.update({ optInFeatures: [...currentFeatures, feature] });
    }
  }

  removeOptInFeature(feature: string) {
    this.update({
      optInFeatures: this.getOptInFeatures().filter(
        (currentFeature) => currentFeature !== feature,
      ),
    });
  }

  wasAuthenticated(): boolean {
    return this.#snapshot.wasAuthenticated ?? false;
  }

  setWasAuthenticated(value: boolean) {
    this.update({ wasAuthenticated: value });
  }

  clear() {
    if (isServerRenderingWeb()) {
      this.#snapshot = getServerDevicePrefsSnapshot();
    } else {
      devicePrefsStorage.remove(DEVICE_PREFS_KEY);
      this.#snapshot = createDefaultDevicePrefs();
    }
    this.#listeners.forEach((listener) => {
      listener();
    });
  }
}

export const DevicePrefs = new DevicePrefsStore();

export function clearDevicePrefs(): void {
  DevicePrefs.clear();
}

export function useDevicePrefs(): DevicePrefsDoc {
  return useSyncExternalStore(
    DevicePrefs.subscribe,
    DevicePrefs.getSnapshot,
    getServerDevicePrefsSnapshot,
  );
}
