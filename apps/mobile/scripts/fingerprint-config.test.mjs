import { createRequire } from "node:module";

import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../fingerprint.config.js");
const { SourceSkips } = require("expo/fingerprint");

it("keeps version numbers and their file out of the runtime fingerprint", () => {
  for (const skip of [
    SourceSkips.PackageJsonScriptsAll,
    SourceSkips.ExpoConfigExtraSection,
    SourceSkips.ExpoConfigVersions,
  ]) {
    expect(config.sourceSkips & skip).toBe(skip);
  }
  expect(config.ignorePaths).toEqual(["native-version.js"]);
});
