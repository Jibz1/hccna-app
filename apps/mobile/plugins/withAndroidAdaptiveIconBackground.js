const { AndroidConfig, withAndroidColors } = require("expo/config-plugins");

const DEFAULT_BACKGROUND_COLOR = "#2c225e";

module.exports = function withAndroidAdaptiveIconBackground(
  config,
  { backgroundColor = DEFAULT_BACKGROUND_COLOR } = {},
) {
  return withAndroidColors(config, (config) => {
    config.modResults = AndroidConfig.Colors.assignColorValue(
      config.modResults,
      {
        name: "iconBackground",
        value: backgroundColor,
      },
    );
    return config;
  });
};

module.exports.DEFAULT_BACKGROUND_COLOR = DEFAULT_BACKGROUND_COLOR;
