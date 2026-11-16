import { useSyncExternalStore } from "react";

import { DevicePrefs } from "@/utils/devicePrefs";

const getTheme = () => DevicePrefs.getTheme();

export function usePreferencesTheme() {
  return useSyncExternalStore(DevicePrefs.subscribe, getTheme, getTheme);
}
