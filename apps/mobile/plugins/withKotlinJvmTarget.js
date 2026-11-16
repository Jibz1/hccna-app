const { withGradleProperties } = require("expo/config-plugins");

module.exports = function withKotlinJvmTarget(config) {
  return withGradleProperties(config, (config) => {
    config.modResults.push({
      type: "property",
      key: "kotlin.jvm.target.validation.mode",
      value: "warning",
    });
    return config;
  });
};
