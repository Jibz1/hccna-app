import { DYNAMIC_CONFIGS } from "@/featureGates/names";

/**
 * Force-update constants and type definitions
 */

/** Statsig dynamic config key for force-update settings */
export const FORCE_UPDATE_CONFIG_KEY = DYNAMIC_CONFIGS.forcedUpdate;

/** iOS App Store ID */
export const IOS_APP_STORE_ID = "6747876650";

/** Android package name */
export const ANDROID_PACKAGE_NAME = "org.hccnj.app";

/** Default store URLs */
export const DEFAULT_IOS_STORE_URL = `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`;
export const DEFAULT_ANDROID_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`;

/** Update types */
export type UpdateType = "hard" | "soft" | null;

/** Force-update configuration from Statsig */
export type ForceUpdateConfig = {
  /** Whether force-update is enabled */
  enabled: boolean;
  /** Minimum version required (hard update below this) */
  minimumVersion: string;
  /** Soft update version (soft prompt below this) */
  softUpdateVersion?: string;
  /** Update type override */
  updateType?: "hard" | "soft";
  /** Title shown in the overlay */
  title: string;
  /** Message shown in the overlay */
  message: string;
  /** Update button text */
  updateButtonText: string;
  /** Dismiss button text (for soft updates) */
  dismissButtonText: string;
  /** Changelog items to display */
  changelog?: string[];
  /** iOS App Store URL override */
  iosStoreUrl?: string;
  /** Android Play Store URL override */
  androidStoreUrl?: string;
};

/** Default configuration when Statsig fails or is not configured */
export const DEFAULT_CONFIG: ForceUpdateConfig = {
  enabled: false,
  minimumVersion: "0.0.0",
  softUpdateVersion: undefined,
  updateType: undefined,
  title: "A new version is here",
  message: "A new version is available with important improvements.",
  updateButtonText: "Update HCC",
  dismissButtonText: "Maybe later",
  changelog: undefined,
  iosStoreUrl: DEFAULT_IOS_STORE_URL,
  androidStoreUrl: DEFAULT_ANDROID_STORE_URL,
};
