const {
  withAppBuildGradle,
  withGradleProperties,
} = require("expo/config-plugins");

const OPTIMIZED_RESOURCE_SHRINKING = "android.r8.optimizedResourceShrinking";

// Expo's default proguard-android.txt includes -dontoptimize. Enabling
// minification alone still leaves R8's code optimizations disabled.
function withOptimizeProguardFile(config) {
  return withAppBuildGradle(config, (config) => {
    const defaultProguardFile =
      /getDefaultProguardFile\(\s*(["'])proguard-android(?:-optimize)?\.txt\1\s*\)/;

    if (
      config.modResults.language !== "groovy" ||
      !defaultProguardFile.test(config.modResults.contents)
    ) {
      throw new Error(
        "[withAndroidCodeOptimization] Expected Expo's default ProGuard configuration in app/build.gradle. Review the Android template before enabling release optimization.",
      );
    }

    config.modResults.contents = config.modResults.contents.replace(
      defaultProguardFile,
      'getDefaultProguardFile("proguard-android-optimize.txt")',
    );

    return config;
  });
}

// AGP 8.12/8.13 only lets R8 shrink resources alongside code behind this flag.
// AGP 9 applies it whenever shrinkResources is on, so drop this after the
// React Native upgrade that brings AGP 9 (Expo SDK 58).
function withOptimizedResourceShrinking(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) =>
        item.type !== "property" || item.key !== OPTIMIZED_RESOURCE_SHRINKING,
    );
    config.modResults.push({
      type: "property",
      key: OPTIMIZED_RESOURCE_SHRINKING,
      value: "true",
    });
    return config;
  });
}

module.exports = function withAndroidCodeOptimization(config) {
  return withOptimizedResourceShrinking(withOptimizeProguardFile(config));
};
