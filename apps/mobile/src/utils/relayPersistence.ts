import { FEATURE_GATES } from "@/featureGates/names";
import { relayEnvironment, relaySettingsStorage } from "@/utils/mmkv";

import {
  clearPersistedRelayRecords,
  type RelayStorageAdapter,
} from "./relayRecordSource";

export const RELAY_CACHE_VERSION = "2";
export const ANONYMOUS_RELAY_AUTH_SCOPE = "anon";
export const RELAY_PERSISTENCE_KILL_SWITCH_GATE_NAME =
  FEATURE_GATES.relayPersistenceKillSwitch;
export const RELAY_PERSISTENCE_LAUNCH_LATCH_KEY =
  "relay_persistence_enabled_next_launch";

export type RelayLaunchSettingsStorage = {
  readonly getBoolean: (key: string) => boolean | undefined;
  readonly set: (key: string, value: boolean) => void;
};

export function clearPersistedRelayStore(scope?: string): void {
  clearPersistedRelayRecords(relayEnvironment, scope);
}

export function getRelayAuthScope(uid?: string | null): string {
  return uid ? `uid:${uid}` : ANONYMOUS_RELAY_AUTH_SCOPE;
}

export function readRelayPersistenceLaunchLatch(
  storage: RelayLaunchSettingsStorage,
): boolean {
  return storage.getBoolean(RELAY_PERSISTENCE_LAUNCH_LATCH_KEY) ?? true;
}

export function writeRelayPersistenceLaunchLatch(
  storage: RelayLaunchSettingsStorage,
  enabled: boolean,
): void {
  storage.set(RELAY_PERSISTENCE_LAUNCH_LATCH_KEY, enabled);
}

export function isRelayPersistenceEnabledForLaunch(): boolean {
  return readRelayPersistenceLaunchLatch(relaySettingsStorage);
}

export function applyRelayPersistenceKillSwitch(
  settings: RelayLaunchSettingsStorage,
  records: RelayStorageAdapter,
  killSwitchActive: boolean,
): void {
  writeRelayPersistenceLaunchLatch(settings, !killSwitchActive);

  if (killSwitchActive) {
    clearPersistedRelayRecords(records);
  }
}

export function applyRelayPersistenceKillSwitchForNextLaunch(
  killSwitchActive: boolean,
): void {
  applyRelayPersistenceKillSwitch(
    relaySettingsStorage,
    relayEnvironment,
    killSwitchActive,
  );
}
