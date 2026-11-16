import { FEATURE_GATES } from "@/featureGates/names";
import { useGate } from "@/featureGates/react";

/**
 * Per-device notification settings. While the gate is off (or missing), the
 * settings UI is hidden and registration sends no category channels, so the
 * device receives everything as before. Saved choices stay on the device and
 * apply again once the gate is on.
 */
export const NOTIFICATION_SETTINGS_GATE = FEATURE_GATES.notificationSettings;

export function useNotificationSettingsEnabled(): boolean {
  return useGate(NOTIFICATION_SETTINGS_GATE);
}
