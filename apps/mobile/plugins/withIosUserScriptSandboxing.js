const { IOSConfig, withXcodeProject } = require("expo/config-plugins");

module.exports = function withIosUserScriptSandboxing(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const { target } = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName: config.modRequest.projectName,
    });

    const configurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      project,
      target.buildConfigurationList,
    );

    // CocoaPods' resource-copy script writes a temporary file under Pods.
    // Override the project default for every app configuration so Xcode does
    // not sandbox that script (or React Native's other build scripts).
    for (const [, configuration] of configurations) {
      configuration.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
    }

    return config;
  });
};
