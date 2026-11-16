import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatNativeVersionFile } from "./versioning";

// The store release every fixture project starts from.
export const storeVersion = { version: "2.1.0", androidVersionCode: 24 };
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const releaseValues = { MMKV_ENCRYPTION_KEY: "release-key" };
export const releaseHashes = { MMKV_ENCRYPTION_KEY: hash("release-key") };
// The EAS production environment after a complete --sync-env.
export const remoteValues = {
  ...releaseValues,
  MMKV_ENCRYPTION_KEY_REQUIRED: "true",
};
export const runtimes = { ios: "store-ios", android: "store-android" };
export const bun = execFileSync(
  "bun",
  ["--no-env-file", "--print", "process.execPath"],
  { encoding: "utf8" },
).trim();
// Prints what a wrapped native tool would receive from the release scripts.
export const envReporter = `#!/usr/bin/env -S bun --no-env-file
console.log(JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  profile: process.env.EAS_BUILD_PROFILE,
  mode: process.env.NODE_ENV,
  variant: process.env.APP_VARIANT,
  dotenvDisabled: process.env.EXPO_NO_DOTENV,
  releaseMarker: process.env.HCCNA_RELEASE_ENV,
  key: process.env.MMKV_ENCRYPTION_KEY,
  url: process.env.EXPO_PUBLIC_API_URL,
  developerValue: process.env.EXPO_PUBLIC_DEVELOPER_ONLY
}));
`;

function writeFixtureFile(directory, file, contents, mode) {
  mkdirSync(dirname(join(directory, file)), { recursive: true });
  writeFileSync(join(directory, file), contents, { mode });
}

export function runFixture(args, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ota-release-test-"));
  const scripts = join(directory, "scripts");
  const bin = join(directory, "bin");
  const log = join(directory, "calls.jsonl");
  mkdirSync(scripts);
  mkdirSync(bin);
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(directory, "node_modules"),
  );
  for (const name of [
    "releaseEnv.ts",
    "generate-android-native-build.ts",
    "publish-update.ts",
    "local-release.ts",
    "versioning.ts",
    "version.ts",
  ]) {
    writeFileSync(
      join(scripts, name),
      readFileSync(new URL(name, import.meta.url)),
    );
  }
  writeFileSync(
    join(directory, "ota-release.json"),
    JSON.stringify({
      mmkvKeySha256: releaseHashes.MMKV_ENCRYPTION_KEY,
      updateValuesSha256:
        "recorded" in options ? options.recorded : releaseHashes,
      runtimeVersions: options.storeRuntimes ?? runtimes,
    }),
  );
  writeFileSync(
    join(directory, "native-version.js"),
    formatNativeVersionFile(options.nativeVersion ?? storeVersion),
  );
  for (const [file, contents] of Object.entries(
    options.files ?? { ".env": "MMKV_ENCRYPTION_KEY=release-key\n" },
  )) {
    writeFixtureFile(directory, file, contents);
  }
  for (const [file, contents] of Object.entries(options.executables ?? {})) {
    writeFixtureFile(directory, file, contents, 0o755);
  }
  const stub = `#!/usr/bin/env node
const fs = require("node:fs");
const { basename } = require("node:path");
const { spawnSync } = require("node:child_process");
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
const call = { command, args, otaVersion: process.env.HCCNA_OTA_VERSION };
// eas-cli exports only iOS and Android when it resolves @expo/cli this way.
if (command === "eas" && args[0] === "update") {
  try {
    require.resolve("@expo/cli/package.json", { paths: [process.cwd()] });
    call.resolvesExpoCli = true;
  } catch {
    call.resolvesExpoCli = false;
  }
}
fs.appendFileSync(process.env.OTA_TEST_LOG, JSON.stringify(call) + "\\n");
if (command === "eas" && args[0] === "env:exec") {
  const env = { ...process.env, ...JSON.parse(process.env.OTA_TEST_REMOTE) };
  const result = spawnSync(process.env.OTA_TEST_BUN, args[2].split(" ").slice(1), { env, encoding: "utf8" });
  process.stdout.write("EAS diagnostic line\\n" + result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
if (command === "eas" && args[0] === "update:list") {
  if (process.env.OTA_TEST_INVALID_UPDATE_LIST) {
    console.log("not json");
    process.exit(0);
  }
  const at = (flag) => Number(args[args.indexOf(flag) + 1]);
  const groups = JSON.parse(process.env.OTA_TEST_UPDATES);
  // eas-cli formats each message as "<message>" (<time> by <actor>).
  const listed = groups.map((group) => ({ ...group, message: (group.message ? '"' + group.message + '" ' : "") + "(1 hour ago by Ada Example)" }));
  console.log(JSON.stringify({ name: "production", id: "branch-id", currentPage: listed.slice(at("--offset"), at("--offset") + at("--limit")) }));
  process.exit(0);
}
if (command === "eas" && args[0] === "env:create" && process.env.OTA_TEST_FAIL_ENV_CREATE) {
  console.error("could not create " + args[args.indexOf("--value") + 1]);
  process.exit(1);
}
if (command === "npx" && args[0] === "--no-install") {
  console.log(JSON.stringify({ runtimeVersion: JSON.parse(process.env.OTA_TEST_RUNTIMES)[args.at(-1)] }));
}
if (command === "npx" && args[0] === "sentry-expo-upload-sourcemaps" && process.env.OTA_TEST_FAIL_SOURCEMAPS) {
  process.exit(1);
}
`;
  for (const name of ["eas", "npx"]) {
    writeFileSync(join(bin, name), stub, { mode: 0o755 });
  }
  if (options.localRelease) {
    writeFileSync(join(bin, "node"), envReporter, { mode: 0o755 });
  }
  try {
    const result = spawnSync(
      bun,
      [
        "--no-env-file",
        join(
          scripts,
          options.script ??
            (options.localRelease ? "local-release.ts" : "publish-update.ts"),
        ),
        ...args,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          EXPO_NO_DOTENV: "0",
          // Fixture runs inside GitHub Actions must not append to the real job
          // summary; tests that read a summary pass their own path in options.env.
          GITHUB_STEP_SUMMARY: "",
          PATH: options.missingCommands
            ? join(directory, "missing")
            : bin + delimiter + process.env.PATH,
          OTA_TEST_REMOTE: JSON.stringify(options.remote ?? remoteValues),
          OTA_TEST_RUNTIMES: JSON.stringify(
            options.resolvedRuntimes ?? runtimes,
          ),
          OTA_TEST_UPDATES: JSON.stringify(options.updates ?? []),
          OTA_TEST_LOG: log,
          OTA_TEST_BUN: bun,
          OTA_TEST_INVALID_UPDATE_LIST: options.invalidUpdateList ? "1" : "",
          OTA_TEST_FAIL_ENV_CREATE: options.failEnvCreate ? "1" : "",
          OTA_TEST_FAIL_SOURCEMAPS: options.failSourceMaps ? "1" : "",
          ...options.env,
        },
      },
    );
    const calls = existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    return { ...result, calls, inspected: options.inspect?.(directory) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// The version fields expo prebuild writes into the generated projects.
export const androidBuildGradle = ({ version, androidVersionCode }) =>
  `android {\n    defaultConfig {\n        versionCode ${androidVersionCode}\n        versionName "${version}"\n    }\n}\n`;
export const iosInfoPlist = (version) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>${version}</string>\n\t<key>CFBundleVersion</key>\n\t<string>1</string>\n</dict>\n</plist>\n`;
