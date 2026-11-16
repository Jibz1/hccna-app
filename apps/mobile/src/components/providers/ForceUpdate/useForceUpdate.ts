import { createContext, use } from "react";
import { Linking, Platform } from "react-native";

import {
  DEFAULT_ANDROID_STORE_URL,
  DEFAULT_IOS_STORE_URL,
  ForceUpdateConfig,
  UpdateType,
} from "./constants";

export type ForceUpdateContextValue = {
  /** Whether an update is required */
  isUpdateRequired: boolean;
  /** Type of update required (hard = blocking, soft = dismissable) */
  updateType: UpdateType;
  /** The force-update configuration */
  config: ForceUpdateConfig | null;
  /** Dismiss the update overlay (soft updates only) */
  dismiss: () => void;
  /** Open the appropriate app store */
  openStore: () => void;
};

export const ForceUpdateContext = createContext<ForceUpdateContextValue | null>(
  null,
);

/**
 * Hook to access force-update state and actions
 * @returns Force-update context value
 */
export function useForceUpdate(): ForceUpdateContextValue {
  const context = use(ForceUpdateContext);
  if (!context) {
    throw new Error("useForceUpdate must be used within a ForceUpdateProvider");
  }
  return context;
}

/**
 * Opens the appropriate app store based on platform
 * @param config - Force-update configuration with store URLs
 */
export function openAppStore(config: ForceUpdateConfig | null): void {
  const url =
    Platform.OS === "ios"
      ? (config?.iosStoreUrl ?? DEFAULT_IOS_STORE_URL)
      : (config?.androidStoreUrl ?? DEFAULT_ANDROID_STORE_URL);

  Linking.openURL(url).catch((error) => {
    console.warn("Failed to open app store:", error);
  });
}
