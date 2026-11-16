const fs = require("fs/promises");
const path = require("path");
const { AndroidConfig, withDangerousMod } = require("expo/config-plugins");

const ANDROID_NATIVE_TAB_BAR_HEIGHT = "60dp";
const DIMENS_FILE_NAME = "hccna_native_tabs_dimens";

function buildDimensXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <!-- Override Material 3's 80dp BottomNavigationView min height for NativeTabs. -->
  <dimen name="m3_bottom_nav_min_height">${ANDROID_NATIVE_TAB_BAR_HEIGHT}</dimen>
</resources>
`;
}

module.exports = function withAndroidNativeTabBarHeight(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const filePath = await AndroidConfig.Paths.getResourceXMLPathAsync(
        config.modRequest.projectRoot,
        { kind: "values", name: DIMENS_FILE_NAME },
      );

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buildDimensXml(), "utf8");

      return config;
    },
  ]);
};

module.exports.ANDROID_NATIVE_TAB_BAR_HEIGHT = ANDROID_NATIVE_TAB_BAR_HEIGHT;
module.exports.buildDimensXml = buildDimensXml;
