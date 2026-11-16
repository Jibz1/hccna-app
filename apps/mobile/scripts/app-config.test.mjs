import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { bun, hash } from "./release-fixtures.mjs";
import { formatNativeVersionFile } from "./versioning";

// Cases spawn nested Bun and Node processes, which can exceed Vitest's 5s
// default while CI runs other packages' suites in parallel.
vi.setConfig({ testTimeout: 30_000 });

const storeBundle = ["export:embed", "--platform", "ios", "--dev", "false"];

// Evaluates a copy of app.config.ts with a fixture key pin, as Expo would for
// the given CLI arguments and environment. Without `nativeVersion`, it uses the
// committed native-version.js.
function evaluateConfig(argv, env = {}, nativeVersion) {
  const directory = mkdtempSync(join(tmpdir(), "app-config-test-"));
  try {
    copyFileSync(
      new URL("../app.config.ts", import.meta.url),
      join(directory, "app.config.ts"),
    );
    if (nativeVersion) {
      writeFileSync(
        join(directory, "native-version.js"),
        formatNativeVersionFile(nativeVersion),
      );
    } else {
      copyFileSync(
        new URL("../native-version.js", import.meta.url),
        join(directory, "native-version.js"),
      );
    }
    writeFileSync(
      join(directory, "ota-release.json"),
      JSON.stringify({ mmkvKeySha256: hash("release-key") }),
    );
    writeFileSync(
      join(directory, "evaluate.mjs"),
      `process.argv.push(...${JSON.stringify(argv)});
const { default: config } = await import("./app.config.ts");
console.log(JSON.stringify({
  key: config.extra.MMKV_ENCRYPTION_KEY ?? "none",
  version: config.version,
  versionCode: config.android.versionCode,
}));
`,
    );
    return spawnSync(bun, ["--no-env-file", "evaluate.mjs"], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const keyOf = (result) => JSON.parse(result.stdout).key;

it("rejects store bundles made outside the release environment", () => {
  const result = evaluateConfig(storeBundle, {
    MMKV_ENCRYPTION_KEY: "release-key",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Store bundles must use the release environment",
  );
});

it("accepts store bundles from the release environment and EAS Build", () => {
  for (const env of [
    {
      HCCNA_RELEASE_ENV: "1",
      EAS_BUILD_PROFILE: "production",
      MMKV_ENCRYPTION_KEY: "release-key",
    },
    { EAS_BUILD: "true", MMKV_ENCRYPTION_KEY: "release-key" },
  ]) {
    const result = evaluateConfig(storeBundle, env);
    expect(result.stderr).toBe("");
    expect(keyOf(result)).toBe("release-key");
  }
});

it("leaves development bundles and plain config reads unguarded", () => {
  for (const argv of [
    ["export:embed", "--platform", "ios", "--dev", "true"],
    ["config", "--json"],
  ]) {
    const result = evaluateConfig(argv);
    expect(result.status).toBe(0);
    expect(keyOf(result)).toBe("none");
  }
});

it("requires the pinned key whenever EAS marks it required", () => {
  const required = { MMKV_ENCRYPTION_KEY_REQUIRED: "true" };
  const missing = evaluateConfig([], required);
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain(
    "Missing MMKV_ENCRYPTION_KEY for production updates",
  );
  const changed = evaluateConfig([], {
    ...required,
    MMKV_ENCRYPTION_KEY: "other-key",
  });
  expect(changed.status).toBe(1);
  expect(changed.stderr).toContain("differs from the key pinned");
  const pinned = evaluateConfig([], {
    ...required,
    MMKV_ENCRYPTION_KEY: "release-key",
  });
  expect(pinned.status).toBe(0);
  expect(keyOf(pinned)).toBe("release-key");
});

it("takes the version and Android version code from native-version.js", () => {
  const result = evaluateConfig(
    [],
    {},
    {
      version: "2.1.0",
      androidVersionCode: 24,
    },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    version: "2.1.0",
    versionCode: 24,
  });
});

const storeRelease = { version: "2.1.0", androidVersionCode: 24 };

it("uses the OTA version that an update publish passes", () => {
  const result = evaluateConfig(
    ["export"],
    { HCCNA_OTA_VERSION: "2.1.3" },
    storeRelease,
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).version).toBe("2.1.3");
});

it("rejects OTA versions of another store release or without an OTA number", () => {
  for (const version of ["2.2.1", "2.1.0", "2.1", "2.1.3-beta"]) {
    const result = evaluateConfig(
      ["export"],
      { HCCNA_OTA_VERSION: version },
      storeRelease,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `HCCNA_OTA_VERSION ${version} is not an OTA version of store release 2.1.0.`,
    );
  }
});

it("keeps an OTA version out of native builds", () => {
  for (const argv of [
    ["prebuild"],
    ["run:ios"],
    ["run:android"],
    storeBundle,
  ]) {
    const result = evaluateConfig(
      argv,
      {
        HCCNA_OTA_VERSION: "2.1.3",
        HCCNA_RELEASE_ENV: "1",
        MMKV_ENCRYPTION_KEY: "release-key",
      },
      storeRelease,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "HCCNA_OTA_VERSION is set for `eas update` only. Unset it before building.",
    );
  }
});
