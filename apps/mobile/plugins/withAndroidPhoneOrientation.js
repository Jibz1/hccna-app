const {
  AndroidConfig,
  CodeGenerator,
  withAppBuildGradle,
  withMainActivity,
} = require("expo/config-plugins");

// Android 16 ignores orientation locks on large screens (smallest width of at
// least 600dp), and Google Play flags apps whose manifest declares one. The
// manifest therefore leaves MainActivity unrestricted, and the activity locks
// portrait at runtime only below that threshold: phones and foldable outer
// screens stay portrait like the iPhone build, while tablets and unfolded
// foldables rotate like the iPad build.
const LARGE_SCREEN_MIN_WIDTH_DP = 600;
const ANDROIDX_WINDOW_DEPENDENCY = "androidx.window:window:1.5.1";
const TAG = "hccna-phone-orientation";

const MAIN_ACTIVITY_IMPORTS = [
  "android.content.pm.ActivityInfo",
  "android.content.res.Configuration",
  "androidx.window.layout.WindowMetricsCalculator",
];

// The policy is re-applied only when the display crosses the threshold
// (folding, unfolding, or moving to another display). Plain rotations keep
// runtime overrides: react-native-webview unlocks orientation for fullscreen
// video and restores it when the video closes.
const MAIN_ACTIVITY_MEMBERS = `  private var isCompactScreen: Boolean? = null

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyOrientationPolicy()
  }

  private fun applyOrientationPolicy() {
    val bounds = WindowMetricsCalculator.getOrCreate().computeMaximumWindowMetrics(this).bounds
    val smallestWidthDp = minOf(bounds.width(), bounds.height()) / resources.displayMetrics.density
    val isCompact = smallestWidthDp < ${LARGE_SCREEN_MIN_WIDTH_DP}
    if (isCompact == isCompactScreen) {
      return
    }
    isCompactScreen = isCompact
    requestedOrientation =
        if (isCompact) {
          ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        } else {
          ActivityInfo.SCREEN_ORIENTATION_FULL_USER
        }
  }
`;

// mergeContents throws when an anchor is missing, so a changed Expo template
// fails prebuild instead of silently dropping the policy.
function addOrientationPolicy(src) {
  src = AndroidConfig.CodeMod.addImports(src, MAIN_ACTIVITY_IMPORTS, false);
  src = CodeGenerator.mergeContents({
    src,
    newSrc: MAIN_ACTIVITY_MEMBERS,
    tag: `${TAG}-members`,
    anchor: /class MainActivity\s*:\s*ReactActivity\(\)\s*\{/,
    offset: 1,
    comment: "//",
  }).contents;
  return CodeGenerator.mergeContents({
    src,
    newSrc: "    applyOrientationPolicy()",
    tag: `${TAG}-on-create`,
    anchor: /^\s*super\.onCreate\(/,
    offset: 1,
    comment: "//",
  }).contents;
}

function addWindowDependency(src) {
  return CodeGenerator.mergeContents({
    src,
    newSrc: `    implementation("${ANDROIDX_WINDOW_DEPENDENCY}")`,
    tag: TAG,
    anchor: /^dependencies\s*\{/,
    offset: 1,
    comment: "//",
  }).contents;
}

module.exports = function withAndroidPhoneOrientation(config) {
  config = withMainActivity(config, (config) => {
    if (config.modResults.language !== "kt") {
      throw new Error(
        "withAndroidPhoneOrientation requires a Kotlin MainActivity.",
      );
    }
    config.modResults.contents = addOrientationPolicy(
      config.modResults.contents,
    );
    return config;
  });

  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error(
        "withAndroidPhoneOrientation requires a Groovy app build.gradle.",
      );
    }
    config.modResults.contents = addWindowDependency(
      config.modResults.contents,
    );
    return config;
  });
};
