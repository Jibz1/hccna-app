import { describe, expect, it, vi } from "vitest";

import { clearUserScopedPersistence } from "@/utils/storageRegistry";

const {
  atomStorage,
  clearAuthPersistenceStorage,
  clearDevicePrefs,
  clearPersistedRelayStore,
  clearPushTokens,
  legacyQueryStorage,
  pushRegistrationStorage,
  relaySettingsStorage,
  savedVersesStorage,
  legacySignalDbStorage,
  statsigStorage,
} = vi.hoisted(() => ({
  clearAuthPersistenceStorage: vi.fn(async () => {}),
  clearDevicePrefs: vi.fn(),
  clearPersistedRelayStore: vi.fn(() => {}),
  clearPushTokens: vi.fn(),
  legacySignalDbStorage: {
    remove: vi.fn(),
  },
  legacyQueryStorage: {
    clearAll: vi.fn(),
  },
  pushRegistrationStorage: {
    clearAll: vi.fn(),
  },
  statsigStorage: {
    clearAll: vi.fn(),
  },
  relaySettingsStorage: {
    clearAll: vi.fn(),
  },
  atomStorage: {
    clearAll: vi.fn(),
  },
  savedVersesStorage: {
    clearAll: vi.fn(),
  },
}));
vi.mock("@/utils/authPersistenceStorage", () => ({
  clearAuthPersistenceStorage,
}));

vi.mock("@/utils/devicePrefs", () => ({
  clearDevicePrefs,
}));

vi.mock("@/utils/pushTokens", () => ({
  clearPushTokens,
}));

vi.mock("@/utils/relayPersistence", () => ({
  clearPersistedRelayStore,
}));

vi.mock("@/utils/mmkv", () => ({
  legacyQueryStorage,
  legacySignalDbStorage,
  pushRegistrationStorage,
  statsigStorage,
  relaySettingsStorage,
  atomStorage,
  savedVersesStorage,
}));

describe("storageRegistry", () => {
  it("clears only user-scoped persistence on logout", async () => {
    await clearUserScopedPersistence();

    expect(legacyQueryStorage.clearAll).toHaveBeenCalledOnce();
    expect(clearPersistedRelayStore).toHaveBeenCalledOnce();
    expect(clearPushTokens).toHaveBeenCalledOnce();
    expect(pushRegistrationStorage.clearAll).toHaveBeenCalledOnce();
    expect(savedVersesStorage.clearAll).toHaveBeenCalledOnce();
    expect(clearAuthPersistenceStorage).not.toHaveBeenCalled();
    expect(clearDevicePrefs).not.toHaveBeenCalled();
    expect(legacySignalDbStorage.remove).toHaveBeenCalledWith("userData");
    expect(legacySignalDbStorage.remove).toHaveBeenCalledWith("giving");
    expect(legacySignalDbStorage.remove).toHaveBeenCalledWith("pushTokens");
    expect(legacySignalDbStorage.remove).not.toHaveBeenCalledWith(
      "devicePrefs",
    );
    expect(statsigStorage.clearAll).not.toHaveBeenCalled();
    expect(relaySettingsStorage.clearAll).not.toHaveBeenCalled();
    expect(atomStorage.clearAll).not.toHaveBeenCalled();
  });
});
