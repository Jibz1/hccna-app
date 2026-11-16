import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import {
  hashUpdateValues,
  KEY_REQUIRED_VARIABLE,
  loadReleaseEnv,
  productionEnv,
  PROJECT_ROOT,
  readStoreRelease,
  run,
  RuntimeVersion,
  RuntimeVersions,
  UpdateValueHashes,
  updateValues,
  withoutUpdateValues,
} from "./releaseEnv";
import {
  nextOtaVersion,
  otaMessage,
  readStoreVersion,
  storeReleaseParts,
  type UpdateGroupSummary,
} from "./versioning";

const ENVIRONMENT = "production";
const REPORT_PREFIX = "ota-release-state ";
const ReleaseReport = Schema.fromJsonString(
  Schema.Struct({
    hashes: UpdateValueHashes,
    keyRequired: Schema.Boolean,
    runtimeVersions: RuntimeVersions,
  }),
);
const ResolvedRuntime = Schema.fromJsonString(
  Schema.Struct({ runtimeVersion: RuntimeVersion }),
);
const UPDATE_LIST_PAGE_SIZE = 50;
const UpdateListPage = Schema.fromJsonString(
  Schema.Struct({
    currentPage: Schema.Array(
      Schema.Struct({
        message: Schema.optionalKey(Schema.NullOr(Schema.String)),
        isRollBackToEmbedded: Schema.Boolean,
      }),
    ),
  }),
);
const Platform = Schema.Literals(["ios", "android", "all"]);
type Platform = typeof Platform.Type;
type RuntimeReport = Record<"ios" | "android", string | null>;

// eas-cli exports only iOS and Android when it can resolve @expo/cli from the
// project; otherwise it also exports Metro web, whose static render fails. Bun's
// isolated install keeps @expo/cli inside expo's own entry, so expose that copy.
function expoCliNodePath() {
  const expoRequire = createRequire(
    fileURLToPath(import.meta.resolve("expo/package.json")),
  );
  const cliModules = dirname(
    dirname(dirname(expoRequire.resolve("@expo/cli/package.json"))),
  );
  return [process.env.NODE_PATH, cliModules].filter(Boolean).join(delimiter);
}

function eas(
  args: string[],
  options: {
    captureStdout?: boolean;
    quiet?: boolean;
    redact?: string[];
    env?: Record<string, string>;
  } = {},
) {
  const { env: extraEnv, ...runOptions } = options;
  // EAS supplies update values; local files and shell overrides must not leak in.
  return run("eas", args, {
    // EAS evaluates the app config once before fetching its environment, so the
    // build-profile guard would reject the missing key there. The EAS
    // environment's MMKV_ENCRYPTION_KEY_REQUIRED turns the guard on afterwards.
    env: {
      ...productionEnv(withoutUpdateValues()),
      EAS_BUILD_PROFILE: undefined,
      // Only the `eas update` call that passes a version may carry one.
      HCCNA_OTA_VERSION: undefined,
      NODE_PATH: expoCliNodePath(),
      ...extraEnv,
    },
    ...runOptions,
  });
}

function readRemote(platform?: Platform) {
  const output = eas(
    [
      "env:exec",
      ENVIRONMENT,
      `bun --no-env-file scripts/publish-update.ts --inspect-release${platform ? ` --platform ${platform}` : ""}`,
      "--non-interactive",
    ],
    { captureStdout: true },
  );
  const report = output
    .split("\n")
    .find((line) => line.startsWith(REPORT_PREFIX));
  try {
    return Schema.decodeUnknownSync(ReleaseReport)(
      report?.slice(REPORT_PREFIX.length),
    );
  } catch {
    throw new Error("EAS did not return a valid release environment report.");
  }
}

function listUpdateGroups() {
  const groups: UpdateGroupSummary[] = [];
  for (let offset = 0; ; offset += UPDATE_LIST_PAGE_SIZE) {
    const output = eas(
      [
        "update:list",
        "--branch",
        "production",
        "--json",
        "--non-interactive",
        "--limit",
        String(UPDATE_LIST_PAGE_SIZE),
        "--offset",
        String(offset),
      ],
      { captureStdout: true },
    );
    let page;
    try {
      page = Schema.decodeUnknownSync(UpdateListPage)(output).currentPage;
    } catch {
      throw new Error(
        "EAS did not return a valid update list; eas-cli's output may have changed.",
      );
    }
    groups.push(...page);
    if (page.length < UPDATE_LIST_PAGE_SIZE) {
      return groups;
    }
  }
}

function writeSummary(line: string) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(summary, `${line}\n`);
  }
}

const isMessageFlag = (arg: string) => arg === "--message" || arg === "-m";

export function versionedPublishArgs(
  publishArgs: readonly string[],
  version: string,
) {
  const index = publishArgs.findIndex(isMessageFlag);
  if (index < 0) {
    throw new Error('Pass --message "..." to describe the update.');
  }
  const message = otaMessage(version, publishArgs[index + 1]);
  return {
    args: publishArgs.map((arg, i) => (i === index + 1 ? message : arg)),
    message,
  };
}

function recordedUpdateValues(release: ReturnType<typeof readStoreRelease>) {
  if (!release.updateValuesSha256) {
    throw new Error(
      "No store release environment recorded in ota-release.json. Record updateValuesSha256 from --print-local-env-hashes after verifying the store build.",
    );
  }
  return new Map(Object.entries(release.updateValuesSha256));
}

function syncEnv() {
  const release = readStoreRelease();
  const values = loadReleaseEnv(release);
  // EAS receives only the reviewed store-release values.
  const drift = compareHashes(
    recordedUpdateValues(release),
    hashUpdateValues(values),
    "the local release files",
  );
  if (drift.length > 0) {
    throw new Error(
      `The local release files do not match ota-release.json:\n${drift.map((item) => `- ${item}`).join("\n")}\nRestore the recorded store-release values before syncing.`,
    );
  }
  // Check the existing key before the first write, including when only public
  // values need changing. A missing key can be bootstrapped from the pinned key.
  const remote = readRemote();
  const remoteKey = remote.hashes.MMKV_ENCRYPTION_KEY;
  if (remoteKey && remoteKey !== release.mmkvKeySha256) {
    throw new Error(
      "EAS MMKV_ENCRYPTION_KEY differs from the pinned store key. Refusing to overwrite production; investigate the existing value first.",
    );
  }
  for (const [name, value] of updateValues(values)) {
    if (name === "MMKV_ENCRYPTION_KEY" && remoteKey) {
      continue;
    }
    // Capture both streams so the CLI cannot echo a value on failure.
    eas(
      [
        "env:create",
        ENVIRONMENT,
        "--name",
        name,
        "--value",
        value,
        "--visibility",
        "sensitive",
        ...(name === "MMKV_ENCRYPTION_KEY" ? [] : ["--force"]),
        "--non-interactive",
      ],
      { quiet: true, redact: [value] },
    );
    console.log(`Set ${name} in the EAS ${ENVIRONMENT} environment.`);
  }
  if (!remote.keyRequired) {
    eas(
      [
        "env:create",
        ENVIRONMENT,
        "--name",
        KEY_REQUIRED_VARIABLE,
        "--value",
        "true",
        "--visibility",
        "plaintext",
        "--force",
        "--non-interactive",
      ],
      { quiet: true },
    );
    console.log(
      `Set ${KEY_REQUIRED_VARIABLE} in the EAS ${ENVIRONMENT} environment.`,
    );
  }
}

export function compareHashes(
  expected: Map<string, string>,
  actual: Map<string, string>,
  source = "EAS",
) {
  return [...new Set([...expected.keys(), ...actual.keys()])]
    .sort()
    .flatMap((name) => {
      const expectedHash = expected.get(name);
      const actualHash = actual.get(name);
      if (expectedHash === actualHash) {
        return [];
      }
      if (!actualHash) {
        return [`${name}: missing from ${source}`];
      }
      if (!expectedHash) {
        return [`${name}: only in ${source}`];
      }
      return [`${name}: values differ`];
    });
}

export function parsePublishArgs(args: string[]) {
  let checkOnly = false;
  let platform: Platform = "all";
  let hasPlatform = false;
  const publishArgs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--check") {
      checkOnly = true;
    } else {
      const separator = arg.indexOf("=");
      const flag = separator < 0 ? arg : arg.slice(0, separator);
      if (["--message", "-m", "--platform", "-p"].includes(flag)) {
        const value = separator < 0 ? args[++index] : arg.slice(separator + 1);
        if (!value) {
          throw new Error(`${flag} requires a value.`);
        }
        if (flag === "--platform" || flag === "-p") {
          if (hasPlatform) {
            throw new Error("Specify --platform only once.");
          }
          if (!Schema.is(Platform)(value)) {
            throw new Error("--platform must be ios, android, or all.");
          }
          platform = value;
          hasPlatform = true;
        }
        // Consume values before looking for wrapper flags: --message "--check"
        // is a literal release message, not a request to skip publishing.
        publishArgs.push(flag, value);
      } else if (["--non-interactive", "--clear-cache"].includes(arg)) {
        publishArgs.push(arg);
      } else {
        throw new Error(
          `Unsupported update option: ${flag}. Use --message, --platform, --non-interactive, or --clear-cache.`,
        );
      }
    }
  }
  return { checkOnly, platform, publishArgs };
}

const platformsFor = (platform: Platform): ("ios" | "android")[] =>
  platform === "all" ? ["ios", "android"] : [platform];

function inspectRelease(args: string[]) {
  const runtimeVersions: RuntimeReport = {
    ios: null,
    android: null,
  };
  if (args.length > 0) {
    // Runs inside `eas env:exec` with exactly the environment used by the export.
    for (const platform of platformsFor(parsePublishArgs(args).platform)) {
      try {
        runtimeVersions[platform] = Schema.decodeUnknownSync(ResolvedRuntime)(
          run(
            "npx",
            [
              "--no-install",
              "expo-updates",
              "runtimeversion:resolve",
              "--platform",
              platform,
            ],
            {
              env: { ...process.env, EXPO_NO_DOTENV: "1" },
              captureStdout: true,
            },
          ),
        ).runtimeVersion;
      } catch (error) {
        // Still report the environment; the publisher rejects the unset runtime.
        console.error(
          `Could not resolve the ${platform} runtime: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  console.log(
    REPORT_PREFIX +
      JSON.stringify({
        hashes: Object.fromEntries(hashUpdateValues(process.env)),
        keyRequired: process.env[KEY_REQUIRED_VARIABLE] === "true",
        runtimeVersions,
      }),
  );
}

function uploadSourceMaps() {
  try {
    run("npx", ["sentry-expo-upload-sourcemaps", "dist"], {
      // A stray shell value must not reach the Sentry CLI's app config.
      env: { ...process.env, HCCNA_OTA_VERSION: undefined },
    });
  } catch (error) {
    // The update is already live; failing here would invite a duplicate publish.
    console.error(
      `${process.env.GITHUB_ACTIONS ? "::warning::" : ""}The update is published, but uploading its Sentry source maps failed (${error instanceof Error ? error.message : String(error)}). Do not publish it again; rerun \`npx sentry-expo-upload-sourcemaps dist\` from apps/mobile while dist still exists.`,
    );
  }
}

function publish(args: string[]) {
  const { checkOnly, platform, publishArgs } = parsePublishArgs(args);
  if (!checkOnly && !publishArgs.some(isMessageFlag)) {
    throw new Error('Pass --message "..." to describe the update.');
  }
  const store = readStoreVersion(PROJECT_ROOT);
  storeReleaseParts(store.version);
  const release = readStoreRelease();
  const expected = recordedUpdateValues(release);
  for (const target of platformsFor(platform)) {
    if (!release.runtimeVersions[target]) {
      throw new Error(
        `No ${target} store runtime recorded in ota-release.json. Record the runtime from a verified OTA-enabled store build before publishing.`,
      );
    }
  }
  const remote = readRemote(platform);
  const mismatches = compareHashes(
    expected,
    new Map(Object.entries(remote.hashes)),
  );
  if (!remote.keyRequired) {
    mismatches.push(
      `${KEY_REQUIRED_VARIABLE}: must be "true" on EAS so the app config rejects a missing or changed key. Run --sync-env.`,
    );
  }
  for (const target of platformsFor(platform)) {
    if (remote.runtimeVersions[target] !== release.runtimeVersions[target]) {
      mismatches.push(
        `${target} runtime differs from the store release (${remote.runtimeVersions[target]} vs ${release.runtimeVersions[target]}). This native change requires a new store build.`,
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `EAS ${ENVIRONMENT} does not match the store release:\n${mismatches.map((item) => `- ${item}`).join("\n")}\nVerify the store build before changing a release baseline.`,
    );
  }
  console.log(
    `EAS ${ENVIRONMENT} environment and ${platform} runtime(s) match the store release.`,
  );
  const otaVersion = nextOtaVersion(store.version, listUpdateGroups());
  console.log(`Next OTA version: ${otaVersion}`);
  if (checkOnly) {
    writeSummary(
      `Next OTA version: **${otaVersion}** (${platform}). Nothing was published.`,
    );
    return;
  }
  const versioned = versionedPublishArgs(publishArgs, otaVersion);
  eas(
    [
      "update",
      "--channel",
      "production",
      "--environment",
      ENVIRONMENT,
      ...versioned.args,
    ],
    { env: { HCCNA_OTA_VERSION: otaVersion } },
  );
  writeSummary(`Published **${versioned.message}** (${platform}).`);
  uploadSourceMaps();
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--inspect-release") {
    inspectRelease(args.slice(1));
  } else if (args[0] === "--print-local-env-hashes" && args.length === 1) {
    console.log(
      JSON.stringify(
        Object.fromEntries(hashUpdateValues(loadReleaseEnv())),
        null,
        2,
      ),
    );
  } else if (args[0] === "--sync-env" && args.length === 1) {
    syncEnv();
  } else {
    publish(args);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
