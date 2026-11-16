const path = require("path");
const { withUniwindConfig } = require("uniwind/metro");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

// Monorepo root — Metro must watch it and resolve through both node_modules trees.
const workspaceRoot = path.resolve(__dirname, "../..");

module.exports = (() => {
  /** @type {import('expo/metro-config').MetroConfig} */
  const config = getSentryExpoConfig(__dirname);

  config.watchFolders = [
    ...new Set([...(config.watchFolders ?? []), workspaceRoot]),
  ];

  // Add resolver configuration for react/compiler-runtime
  config.resolver = {
    ...config.resolver,
    nodeModulesPaths: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    resolveRequest: (context, moduleName, platform) => {
      // Handle react/compiler-runtime
      if (moduleName === "react/compiler-runtime") {
        return {
          filePath: require.resolve("react/compiler-runtime"),
          type: "sourceFile",
        };
      }

      // Use default resolution for other modules
      return context.resolveRequest(context, moduleName, platform);
    },
  };

  return withUniwindConfig(config, {
    cssEntryFile: "./global.css",
  });
})();
