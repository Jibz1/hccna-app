const { SourceSkips } = require("expo/fingerprint");

// `extra` holds JS-only runtime values (the MMKV key, OAuth client ID) that OTA
// updates deliver in their own manifest. Local builds read them from .env while
// `eas update --environment` reads the EAS environment, so hashing them would
// give a build and its updates different runtime versions. package.json scripts
// never reach the native build either.
// Version numbers change with every store release and OTA update without
// changing native code. `app.config.ts` requires native-version.js, which would
// otherwise be hashed as a config plugin file.
/** @type {import("expo/fingerprint").Config} */
module.exports = {
  sourceSkips:
    SourceSkips.PackageJsonScriptsAll |
    SourceSkips.ExpoConfigExtraSection |
    SourceSkips.ExpoConfigVersions,
  ignorePaths: ["native-version.js"],
};
