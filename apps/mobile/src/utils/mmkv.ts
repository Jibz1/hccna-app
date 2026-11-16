import { createLiveNativeMMKV } from "@/effect/storageServiceLive";

export const legacySignalDbStorage = createLiveNativeMMKV({
  id: "signaldb.v63",
  requiresEncryption: true,
});

export const relayEnvironment = createLiveNativeMMKV({
  id: "hccna-relay-environment",
  requiresEncryption: true,
});

export const relaySettingsStorage = createLiveNativeMMKV({
  id: "hccna.relay.settings.v1",
});

export const devicePrefsStorage = createLiveNativeMMKV({
  id: "hccna.device-prefs.v1",
  requiresEncryption: true,
});

export const pushTokenStorage = createLiveNativeMMKV({
  id: "hccna.push-tokens.v1",
  requiresEncryption: true,
});

// Keep this installed storage ID so pending registrations survive app updates.
export const pushLogoutStorage = createLiveNativeMMKV({
  id: "hccna.push-logout.v1",
  requiresEncryption: true,
});

export const pushRegistrationStorage = createLiveNativeMMKV({
  id: "hccna.push-token-outbox.v1",
  requiresEncryption: true,
});

export const legacyQueryStorage = createLiveNativeMMKV({
  id: "hccna-query-client-v2",
  requiresEncryption: true,
});

export const atomStorage = createLiveNativeMMKV({
  id: "hccna.atom.v1",
  requiresEncryption: true,
});

export const savedVersesStorage = createLiveNativeMMKV({
  id: "hccna.saved-verses.v1",
  requiresEncryption: true,
});

export const statsigStorage = createLiveNativeMMKV({
  id: "hccna.statsig.v1",
});
