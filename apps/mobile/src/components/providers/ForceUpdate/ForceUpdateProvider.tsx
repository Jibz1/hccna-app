import * as Application from "expo-application";
import { type ReactNode, useState } from "react";
import { Platform } from "react-native";

import { OtaUpdatePrompt } from "@/components/providers/OtaUpdate/OtaUpdatePrompt";
import { useConfig } from "@/featureGates/react";

import {
  DEFAULT_CONFIG,
  FORCE_UPDATE_CONFIG_KEY,
  ForceUpdateConfig,
  UpdateType,
} from "./constants";
import { ForceUpdateOverlay } from "./ForceUpdateOverlay";
import { ForceUpdateContext, openAppStore } from "./useForceUpdate";
import { isVersionLessThan, isVersionValid } from "./versionUtils";

type ForceUpdateProviderProps = {
  children: ReactNode;
};

const IS_WEB = Platform.OS === "web";

/**
 * Determines the update type based on current version and config
 */
function getUpdateType(
  currentVersion: string,
  config: ForceUpdateConfig,
): UpdateType {
  // Skip on web
  if (IS_WEB) {
    return null;
  }

  if (!config.enabled) {
    return null;
  }

  if (!isVersionValid(currentVersion)) {
    console.warn(
      `[ForceUpdate] Invalid current version: "${currentVersion}", skipping update check`,
    );
    return null;
  }

  // Check hard update first (minimum version)
  if (
    config.minimumVersion &&
    isVersionValid(config.minimumVersion) &&
    isVersionLessThan(currentVersion, config.minimumVersion)
  ) {
    return "hard";
  }

  // Check soft update (soft update version)
  if (
    config.softUpdateVersion &&
    isVersionValid(config.softUpdateVersion) &&
    isVersionLessThan(currentVersion, config.softUpdateVersion)
  ) {
    return "soft";
  }

  // Override from config
  if (config.updateType) {
    return config.updateType;
  }

  return null;
}

export function ForceUpdateProvider({ children }: ForceUpdateProviderProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  // Get dynamic config from Statsig
  const { value: configValue } = useConfig(FORCE_UPDATE_CONFIG_KEY);

  // Merge with defaults
  const config: ForceUpdateConfig = {
    ...DEFAULT_CONFIG,
    ...configValue,
  };

  // Get current app version, fallback to "0.0.0" if unavailable
  const currentVersion = Application.nativeApplicationVersion ?? "0.0.0";

  // Determine update type
  const updateType = getUpdateType(currentVersion, config);

  // Whether to show the overlay
  const isUpdateRequired = updateType !== null;
  const shouldShowOverlay =
    isUpdateRequired && (updateType === "hard" || !isDismissed);

  // Handlers
  const handleDismiss = () => {
    if (updateType === "soft") {
      setIsDismissed(true);
    }
  };

  const handleOpenStore = () => {
    openAppStore(config);
  };

  // Context value
  const contextValue = {
    isUpdateRequired,
    updateType,
    config,
    dismiss: handleDismiss,
    openStore: handleOpenStore,
  };

  return (
    <ForceUpdateContext.Provider value={contextValue}>
      {children}
      {/* A required store update outranks an OTA update for the old build. */}
      {shouldShowOverlay ? (
        <ForceUpdateOverlay
          config={config}
          updateType={updateType}
          onUpdate={handleOpenStore}
          onDismiss={handleDismiss}
        />
      ) : (
        <OtaUpdatePrompt />
      )}
    </ForceUpdateContext.Provider>
  );
}
