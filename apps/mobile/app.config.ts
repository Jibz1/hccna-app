import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExpoConfig } from "@expo/config-types";

import NATIVE_VERSION from "./native-version";

const APP_IDENTIFIER = "org.hccnj.app";
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const EAS_PROJECT_ID = "01811635-30c1-4622-9655-25701e81677b";
const IS_DEVELOPMENT_BUILD = process.env.APP_VARIANT === "development";
const EAS_BUILD_PROFILE = process.env.EAS_BUILD_PROFILE;
// Expo extra values are embedded in the client. This key protects local data at
// rest but must not be treated as a server-side secret. Never substitute a
// placeholder: OTA updates replace the extra values, and a wrong key cannot
// read the stores users already have. Without a key, development uses
// unencrypted storage and production refuses to open encrypted stores.
const MMKV_ENCRYPTION_KEY = process.env.MMKV_ENCRYPTION_KEY;
// The EAS production environment sets MMKV_ENCRYPTION_KEY_REQUIRED, so
// `eas update` checks the key in the same config evaluation it publishes.
const IS_PRODUCTION_KEY_REQUIRED =
  EAS_BUILD_PROFILE === "production" ||
  process.env.MMKV_ENCRYPTION_KEY_REQUIRED === "true";
const SHOULD_REQUIRE_MMKV_ENCRYPTION_KEY =
  EAS_BUILD_PROFILE === "preview" || IS_PRODUCTION_KEY_REQUIRED;
// Xcode and Gradle bundle store builds with `expo export:embed --dev false`.
const DEV_ARGUMENT_INDEX = process.argv.indexOf("--dev");
const IS_STORE_BUNDLE =
  process.argv.includes("export:embed") &&
  DEV_ARGUMENT_INDEX >= 0 &&
  process.argv[DEV_ARGUMENT_INDEX + 1] === "false";
const ANDROID_ADAPTIVE_ICON_BACKGROUND = "#2c225e";
// The OTA publisher sets this for `eas update` only; native builds keep the
// store version from native-version.js.
const OTA_VERSION = process.env.HCCNA_OTA_VERSION;
const IS_NATIVE_BUILD = [
  "prebuild",
  "run:ios",
  "run:android",
  "export:embed",
].some((command) => process.argv.includes(command));

if (OTA_VERSION !== undefined) {
  if (IS_NATIVE_BUILD) {
    throw new Error(
      "[app.config] HCCNA_OTA_VERSION is set for `eas update` only. Unset it before building.",
    );
  }
  const [major, store] = NATIVE_VERSION.version.split(".");
  if (!new RegExp(`^${major}\\.${store}\\.[1-9]\\d*$`).test(OTA_VERSION)) {
    throw new Error(
      `[app.config] HCCNA_OTA_VERSION ${OTA_VERSION} is not an OTA version of store release ${NATIVE_VERSION.version}.`,
    );
  }
}

// Expo's own .env selection includes developer-local files, so store bundles
// must come from the explicit release environment in scripts/releaseEnv.ts.
if (
  IS_STORE_BUNDLE &&
  process.env.EAS_BUILD !== "true" &&
  process.env.HCCNA_RELEASE_ENV !== "1"
) {
  throw new Error(
    "[app.config] Store bundles must use the release environment. Build with `bun run ios:release`, `android:release`, or `android:bundle`, or run `bun run prebuild:release` before archiving in Xcode.",
  );
}

if (SHOULD_REQUIRE_MMKV_ENCRYPTION_KEY && !MMKV_ENCRYPTION_KEY) {
  throw new Error(
    `[app.config] Missing MMKV_ENCRYPTION_KEY for ${EAS_BUILD_PROFILE ? `the ${EAS_BUILD_PROFILE} build profile` : "production updates"}. Set it in the matching EAS environment or release .env files.`,
  );
}

if (
  IS_PRODUCTION_KEY_REQUIRED &&
  MMKV_ENCRYPTION_KEY &&
  createHash("sha256").update(MMKV_ENCRYPTION_KEY).digest("hex") !==
    readPinnedKeyHash()
) {
  throw new Error(
    "[app.config] MMKV_ENCRYPTION_KEY differs from the key pinned in ota-release.json. Shipped builds cannot read stores encrypted with another key.",
  );
}

// Read rather than import: imported modules are fingerprint sources, and
// recording a runtime in ota-release.json must not change that runtime.
function readPinnedKeyHash(): string {
  const release: { mmkvKeySha256: string } = JSON.parse(
    readFileSync(join(__dirname, "ota-release.json"), "utf8"),
  );
  return release.mmkvKeySha256;
}

const config: ExpoConfig = {
  name: IS_DEVELOPMENT_BUILD ? "HCCNA (Dev)" : "HCCNA",
  slug: "hccna",
  version: OTA_VERSION ?? NATIVE_VERSION.version,
  icon: "./assets/images/icon2.png",
  scheme: "hccna",
  userInterfaceStyle: "automatic",
  assetBundlePatterns: ["**/*"],

  ios: {
    associatedDomains: [
      "applinks:app-hccnj.firebaseapp.com",
      "applinks:app.hccnj.org",
      "applinks:hccnj.org",
      "applinks:auth.hccna.church",
      "applinks:hccna.church",
    ],
    bundleIdentifier: APP_IDENTIFIER,
    supportsTablet: true,
    requireFullScreen: false,
    usesAppleSignIn: true,
    googleServicesFile: "./GoogleService-Info.plist",
    infoPlist: {
      AppStoreID: "6747876650",
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ["remote-notification", "audio", "fetch"],
      // Phones stay portrait and tablets rotate. Android applies the same split
      // at runtime in plugins/withAndroidPhoneOrientation.js, because Google
      // Play flags a manifest orientation lock.
      UISupportedInterfaceOrientations: [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
      ],
      "UISupportedInterfaceOrientations~ipad": [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
    },
    entitlements: {
      "aps-environment": IS_DEVELOPMENT_BUILD ? "development" : "production",
      "com.apple.developer.devicecheck.appattest-environment": "production",
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      monochromeImage: "./assets/images/adaptive-icon.png",
      backgroundColor: ANDROID_ADAPTIVE_ICON_BACKGROUND,
    },
    package: APP_IDENTIFIER,
    googleServicesFile: "./google-services.json",
    versionCode: NATIVE_VERSION.androidVersionCode,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "hccna" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-image",
    "expo-sharing",
    "expo-secure-store",
    [
      "expo-notifications",
      {
        icon: "./assets/images/adaptive-icon.png",
        color: "#3A1167",
      },
    ],
    "expo-web-browser",
    "@react-native-firebase/app",
    "@react-native-firebase/app-check",
    "@react-native-firebase/auth",
    "@react-native-firebase/messaging",
    "expo-apple-authentication",
    [
      "expo-image-picker",
      {
        photosPermission:
          "The app accesses your photos to let you change your profile picture.",
        cameraPermission:
          "The app accesses your camera to let you take a profile picture.",
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/icon.png",
        imageWidth: 85,
        resizeMode: "contain",
        backgroundColor: "#FFFFFF",
        dark: {
          backgroundColor: "#211C19",
        },
      },
    ],
    "@react-native-google-signin/google-signin",
    "expo-asset",
    [
      "@sentry/react-native",
      {
        url: "https://sentry.io/",
        project: "app",
        organization: "hccna",
      },
    ],
    "expo-status-bar",
    "./plugins/withKotlinJvmTarget",
    "./plugins/withAndroidFcmDefaultChannel",
    "./plugins/withAndroidNativeTabBarHeight",
    "./plugins/withAndroidPhoneOrientation",
    [
      "./plugins/withAndroidAdaptiveIconBackground",
      { backgroundColor: ANDROID_ADAPTIVE_ICON_BACKGROUND },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "16.4",
          // React Native Firebase 27 installs the Firebase Apple SDK only
          // through Swift Package Manager, which needs dynamic frameworks:
          // its pod install rejects static linkage.
          useFrameworks: "dynamic",
          buildReactNativeFromSource: true,
          usePrecompiledModules: false,
          // Dev-client network inspector buffers every request/response body
          // in RAM for the whole session, poisoning long dev runs and memory
          // profiling. Flip to true temporarily to inspect traffic.
          networkInspector: false,
        },
        android: {
          targetSdkVersion: 36,
          minSdkVersion: 24,
          compileSdkVersion: 37,
          // Firebase Android BoM 35 ships Kotlin 2.4 metadata; React Native
          // 0.88 defaults to Kotlin 2.2, which cannot read it. Expo publishes
          // its Kotlin compiler plugins per Kotlin version, so use one it has
          // a build for (io.github.expo:expo-modules-v2-compiler-plugin).
          kotlinVersion: "2.4.20",
          networkInspector: false,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    "./plugins/withAndroidCodeOptimization",
    "./plugins/withReactNativeSkiaHeaderSearchPaths",
    "./plugins/withIosUserScriptSandboxing",
    [
      "expo-font",
      {
        fonts: [
          "node_modules/@expo-google-fonts/work-sans/400Regular/WorkSans_400Regular.ttf",
          "node_modules/@expo-google-fonts/work-sans/500Medium/WorkSans_500Medium.ttf",
          "node_modules/@expo-google-fonts/work-sans/600SemiBold/WorkSans_600SemiBold.ttf",
        ],
      },
    ],
  ],
  extra: {
    EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN:
      process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN,
    EXPO_PUBLIC_GOOGLE_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    MMKV_ENCRYPTION_KEY,
    eas: {
      projectId: EAS_PROJECT_ID,
    },
  },
  // Builds and updates share a runtime only when their native fingerprints
  // match; fingerprint.config.js keeps the env-dependent extra section out.
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    // Local builds request the production channel themselves. EAS Build
    // replaces this header with each eas.json profile's channel, so preview
    // and development builds never receive production updates.
    requestHeaders: { "expo-channel-name": "production" },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

if (APPLE_TEAM_ID && config.ios) {
  config.ios.appleTeamId = APPLE_TEAM_ID;
}

export default config;
