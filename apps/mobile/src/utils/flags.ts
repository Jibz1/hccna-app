import { Platform } from "react-native";

import { getEnvString } from "@/utils/runtimeConfig";

/**
 * Set to `true` if the app is running in a Chrome extension.
 * TODO: Probably remove this or make this something like `__IS_EXTENSION__` that we can define statically during minification.
 */

export const IS_WEBSITE = getEnvString("EXPO_PUBLIC_WEBSITE") === "true";
export const IS_WEB = Platform.OS === "web";

export const getPlatform = () => {
  if (IS_WEBSITE) {
    return "web";
  }
  return Platform.OS;
};
