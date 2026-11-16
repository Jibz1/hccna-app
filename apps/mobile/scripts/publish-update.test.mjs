import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  compareHashes,
  parsePublishArgs,
  versionedPublishArgs,
} from "./publish-update";
import {
  hash,
  releaseHashes,
  releaseValues,
  remoteValues,
  runFixture,
  runtimes,
} from "./release-fixtures.mjs";

// Cases spawn nested Bun and Node processes, which can exceed Vitest's 5s
// default while CI runs other packages' suites in parallel.
vi.setConfig({ testTimeout: 30_000 });

const commands = (result) => result.calls.map(({ args }) => args[0]);
const writes = (result) =>
  result.calls.filter(({ args }) => args[0] === "env:create");

describe("OTA argument parsing", () => {
  it("accepts --check in any position and consumes literal message values first", () => {
    expect(
      parsePublishArgs(["--message", "--check", "--platform", "ios"]),
    ).toEqual({
      checkOnly: false,
      platform: "ios",
      publishArgs: ["--message", "--check", "--platform", "ios"],
    });
    expect(
      parsePublishArgs(["--check", "-m", "--check", "-p=android"]),
    ).toEqual({
      checkOnly: true,
      platform: "android",
      publishArgs: ["-m", "--check", "-p", "android"],
    });
    expect(parsePublishArgs(["--message=--check", "--check"]).checkOnly).toBe(
      true,
    );
  });

  it("rejects ambiguous platforms and options that bypass the checked export", () => {
    for (const args of [
      ["--platform", "web"],
      ["--platform"],
      ["-p", "ios", "--platform", "android"],
      ["--skip-bundler"],
      ["--input-dir", "other"],
      ["--environment", "preview"],
      ["--channel", "other"],
      ["--ci"],
    ]) {
      expect(() => parsePublishArgs(args)).toThrow();
    }
  });
});

describe("OTA store release record", () => {
  it("reports only names for changed, missing, and additional environment values", () => {
    expect(
      compareHashes(
        new Map(
          Object.entries({
            ...releaseHashes,
            EXPO_PUBLIC_API_URL: hash("https://example.com"),
          }),
        ),
        new Map(
          Object.entries({
            MMKV_ENCRYPTION_KEY: hash("other-key"),
            EXPO_PUBLIC_DEBUG: hash("true"),
          }),
        ),
      ),
    ).toEqual([
      "EXPO_PUBLIC_API_URL: missing from EAS",
      "EXPO_PUBLIC_DEBUG: only in EAS",
      "MMKV_ENCRYPTION_KEY: values differ",
    ]);
  });

  it("requires a recorded store environment before reading EAS", () => {
    const result = runFixture(["--check"], { recorded: null });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No store release environment recorded");
    expect(result.calls).toEqual([]);
  });

  it("rejects a record that changes the pinned key", () => {
    const result = runFixture(["--check"], {
      recorded: { MMKV_ENCRYPTION_KEY: hash("other-key") },
      remote: { ...remoteValues, MMKV_ENCRYPTION_KEY: "other-key" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must record MMKV_ENCRYPTION_KEY");
    expect(result.calls).toEqual([]);
  });

  it("checks both runtimes against the record without local files or publishing", () => {
    const result = runFixture(["--check"], { files: {} });
    expect(result.status).toBe(0);
    expect(commands(result)).toEqual([
      "env:exec",
      "--no-install",
      "--no-install",
      "update:list",
    ]);
    expect(result.calls.slice(1, 3).map(({ args }) => args.at(-1))).toEqual([
      "ios",
      "android",
    ]);
    expect(result.stdout).toContain("Next OTA version: 2.1.1");
  });

  it("stops before publishing when EAS values differ, without printing them", () => {
    const result = runFixture(["--message", "release"], {
      remote: { ...remoteValues, MMKV_ENCRYPTION_KEY: "other-key" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MMKV_ENCRYPTION_KEY: values differ");
    expect(commands(result)).not.toContain("update");
    expect(result.stderr).not.toContain("other-key");
  });

  it("requires EAS to make the app config enforce the key", () => {
    const result = runFixture(["--message", "release"], {
      remote: releaseValues,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'MMKV_ENCRYPTION_KEY_REQUIRED: must be "true"',
    );
    expect(commands(result)).not.toContain("update");
  });

  it("rejects either platform's native drift before publishing all platforms", () => {
    for (const platform of ["ios", "android"]) {
      const result = runFixture(["--message", "release"], {
        resolvedRuntimes: { ...runtimes, [platform]: "unshipped-runtime" },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${platform} runtime differs`);
      expect(commands(result)).not.toContain("update");
      expect(commands(result)).not.toContain("sentry-expo-upload-sourcemaps");
    }
  });

  it("requires a recorded store runtime only for selected platforms", () => {
    const options = { storeRuntimes: { ...runtimes, android: null } };
    const all = runFixture(["--check"], options);
    expect(all.status).toBe(1);
    expect(all.stderr).toContain("No android store runtime recorded");
    expect(all.calls).toEqual([]);
    const ios = runFixture(["--check", "--platform", "ios"], options);
    expect(ios.status).toBe(0);
    expect(commands(ios)).toEqual(["env:exec", "--no-install", "update:list"]);
  });

  it("publishes literal messages after exactly one environment/runtime preflight", () => {
    const message = "Fix times; $(echo literal)";
    const result = runFixture([
      "--message",
      message,
      "--platform",
      "ios",
      "--non-interactive",
    ]);
    expect(result.status).toBe(0);
    expect(result.calls.map(({ args }) => args)).toEqual([
      [
        "env:exec",
        "production",
        "bun --no-env-file scripts/publish-update.ts --inspect-release --platform ios",
        "--non-interactive",
      ],
      [
        "--no-install",
        "expo-updates",
        "runtimeversion:resolve",
        "--platform",
        "ios",
      ],
      [
        "update:list",
        "--branch",
        "production",
        "--json",
        "--non-interactive",
        "--limit",
        "50",
        "--offset",
        "0",
      ],
      [
        "update",
        "--channel",
        "production",
        "--environment",
        "production",
        "--message",
        `2.1.1 · ${message}`,
        "--platform",
        "ios",
        "--non-interactive",
      ],
      ["sentry-expo-upload-sourcemaps", "dist"],
    ]);
    expect(
      result.calls.find(({ args }) => args[0] === "update").otaVersion,
    ).toBe("2.1.1");
  });

  it("keeps a published update when the source-map upload fails", () => {
    const result = runFixture(["--message", "release"], {
      failSourceMaps: true,
    });
    expect(result.status).toBe(0);
    expect(commands(result).filter((name) => name === "update")).toHaveLength(
      1,
    );
    expect(result.stderr).toContain("Do not publish it again");
  });

  it("reports an absent EAS executable as a spawn error", () => {
    const result = runFixture(["--check"], { missingCommands: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ENOENT|Executable not found/);
    expect(result.stderr).toContain("eas");
    expect(result.stderr).not.toContain("exited with null");
  });
});

describe("release environment selection and synchronization", () => {
  const files = {
    ".env":
      "MMKV_ENCRYPTION_KEY=release-key\nEXPO_PUBLIC_API_URL=https://base.example.com\nSENTRY_AUTH_TOKEN=sentry-fixture\nKEYSTORE_PASSWORD=keystore-fixture\n",
    ".env.production":
      "EXPO_PUBLIC_API_URL=https://release.example.com\nEXPO_PUBLIC_EXPANDED=${EXPO_PUBLIC_API_URL}/v1\n",
    ".env.local":
      "MMKV_ENCRYPTION_KEY=developer-key\nEXPO_PUBLIC_DEVELOPER_ONLY=true\n",
    ".env.production.local":
      "EXPO_PUBLIC_API_URL=https://developer.example.com\n",
  };
  const env = {
    MMKV_ENCRYPTION_KEY: "shell-key",
    EXPO_PUBLIC_API_URL: "https://shell.example.com",
    EXPO_PUBLIC_SHELL_ONLY: "shell-fixture",
  };
  const expected = {
    EXPO_PUBLIC_API_URL: hash("https://release.example.com"),
    EXPO_PUBLIC_EXPANDED: hash("https://release.example.com/v1"),
    ...releaseHashes,
  };

  it("prints a sorted, recordable baseline from explicit files, excluding developer and shell values", () => {
    const result = runFixture(["--print-local-env-hashes"], { files, env });
    expect(result.status).toBe(0);
    const recorded = JSON.parse(result.stdout);
    expect(recorded).toEqual(expected);
    expect(Object.keys(recorded)).toEqual(Object.keys(recorded).toSorted());
    expect(result.stderr).toContain(
      "highest priority first): .env.production, .env.",
    );
    expect(result.calls).toEqual([]);
    const check = runFixture(["--check"], {
      recorded,
      remote: {
        ...remoteValues,
        EXPO_PUBLIC_API_URL: "https://release.example.com",
        EXPO_PUBLIC_EXPANDED: "https://release.example.com/v1",
      },
      files: {},
    });
    expect(check.status).toBe(0);
  });

  it("records, checks, and syncs APPLE_TEAM_ID because it changes the native config", () => {
    const teamFiles = {
      ".env": "MMKV_ENCRYPTION_KEY=release-key\nAPPLE_TEAM_ID=TEAM000001\n",
    };
    const printed = runFixture(["--print-local-env-hashes"], {
      files: teamFiles,
    });
    expect(printed.status).toBe(0);
    const recorded = JSON.parse(printed.stdout);
    expect(recorded).toEqual({
      APPLE_TEAM_ID: hash("TEAM000001"),
      ...releaseHashes,
    });
    // A shell value must not hide a team ID missing from EAS.
    const missing = runFixture(["--check"], {
      recorded,
      files: {},
      env: { APPLE_TEAM_ID: "TEAM000001" },
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("APPLE_TEAM_ID: missing from EAS");
    const synced = runFixture(["--sync-env"], { files: teamFiles, recorded });
    expect(synced.status).toBe(0);
    expect(writes(synced).map(({ args }) => args[3])).toEqual([
      "APPLE_TEAM_ID",
    ]);
  });

  it("reads the explicit files even when the shell sets EXPO_NO_DOTENV", () => {
    const result = runFixture(["--print-local-env-hashes"], {
      files,
      env: { EXPO_NO_DOTENV: "1" },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(expected);
  });

  it("bootstraps only update variables and the key requirement after checking EAS", () => {
    const result = runFixture(["--sync-env"], {
      files,
      env,
      recorded: expected,
      remote: {},
    });
    expect(result.status).toBe(0);
    expect(commands(result)[0]).toBe("env:exec");
    expect(writes(result).map(({ args }) => args)).toEqual([
      [
        "env:create",
        "production",
        "--name",
        "MMKV_ENCRYPTION_KEY",
        "--value",
        "release-key",
        "--visibility",
        "sensitive",
        "--non-interactive",
      ],
      [
        "env:create",
        "production",
        "--name",
        "EXPO_PUBLIC_API_URL",
        "--value",
        "https://release.example.com",
        "--visibility",
        "sensitive",
        "--force",
        "--non-interactive",
      ],
      [
        "env:create",
        "production",
        "--name",
        "EXPO_PUBLIC_EXPANDED",
        "--value",
        "https://release.example.com/v1",
        "--visibility",
        "sensitive",
        "--force",
        "--non-interactive",
      ],
      [
        "env:create",
        "production",
        "--name",
        "MMKV_ENCRYPTION_KEY_REQUIRED",
        "--value",
        "true",
        "--visibility",
        "plaintext",
        "--force",
        "--non-interactive",
      ],
    ]);
    for (const secret of [
      "release-key",
      "sentry-fixture",
      "keystore-fixture",
      "shell-fixture",
    ]) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
  });

  it("does not rewrite an existing matching key or key requirement", () => {
    const result = runFixture(["--sync-env"], { files, recorded: expected });
    expect(result.status).toBe(0);
    expect(writes(result).map(({ args }) => args[3])).toEqual([
      "EXPO_PUBLIC_API_URL",
      "EXPO_PUBLIC_EXPANDED",
    ]);
  });

  it("refuses any mutation when the existing EAS key differs", () => {
    const result = runFixture(["--sync-env"], {
      files,
      recorded: expected,
      remote: { ...remoteValues, MMKV_ENCRYPTION_KEY: "other-key" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to overwrite production");
    expect(commands(result)).toEqual(["env:exec"]);
  });

  it("refuses to sync local values that differ from the record", () => {
    const result = runFixture(["--sync-env"], { files });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "EXPO_PUBLIC_API_URL: only in the local release files",
    );
    expect(result.calls).toEqual([]);
  });

  it("reports EAS write failures without the written value", () => {
    const result = runFixture(["--sync-env"], {
      files,
      recorded: expected,
      remote: {},
      failEnvCreate: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "eas env:create exited with 1:\ncould not create [redacted]",
    );
    expect(result.stderr).not.toContain("release-key");
  });

  it("refuses sync and baseline generation with a missing or changed local key", () => {
    for (const key of ["", "wrong-key"]) {
      for (const flag of ["--sync-env", "--print-local-env-hashes"]) {
        const result = runFixture([flag], {
          files: { ".env": `MMKV_ENCRYPTION_KEY=${key}\n` },
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("MMKV_ENCRYPTION_KEY");
        expect(result.stdout).toBe("");
        expect(result.calls).toEqual([]);
      }
    }
  });
});

describe("EAS export", () => {
  // eas-cli exports only iOS and Android when it can resolve @expo/cli from
  // the app. Otherwise it also exports Metro web, whose static render fails,
  // so all-platform publishes would stop at the export.
  it("lets eas-cli resolve expo's @expo/cli so updates never export web", () => {
    const result = runFixture(["--message", "release", "--platform", "ios"]);
    expect(result.status).toBe(0);
    expect(result.calls.find(({ args }) => args[0] === "update")).toMatchObject(
      { resolvesExpoCli: true },
    );
  });
});

describe("OTA version numbers", () => {
  const withSummary = (run) => {
    const directory = mkdtempSync(join(tmpdir(), "ota-summary-"));
    const summary = join(directory, "summary.md");
    try {
      const result = run({ GITHUB_STEP_SUMMARY: summary });
      return { result, summary: readFileSync(summary, "utf8") };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it("prefixes --message, -m, and --message= values", () => {
    for (const args of [
      ["--message", "Fix"],
      ["-m", "Fix"],
      ["--message=Fix"],
      ["-m=Fix"],
    ]) {
      const { publishArgs } = parsePublishArgs(args);
      expect(versionedPublishArgs(publishArgs, "2.1.3")).toEqual({
        args: [publishArgs[0], "2.1.3 · Fix"],
        message: "2.1.3 · Fix",
      });
    }
  });

  it("numbers an update after the highest OTA published on this store release", () => {
    const result = runFixture(
      ["--message", "Fix giving link", "--platform", "ios"],
      {
        updates: [
          { message: "2.1.9 · Ninth", isRollBackToEmbedded: false },
          { message: "2.1.10 · Tenth", isRollBackToEmbedded: false },
          { message: "2.1.12 · Rolled back", isRollBackToEmbedded: true },
          {
            message: "2.0.4 · Older store release",
            isRollBackToEmbedded: false,
          },
          { message: "OTA test", isRollBackToEmbedded: false },
          { message: null, isRollBackToEmbedded: false },
        ],
      },
    );
    expect(result.status).toBe(0);
    const update = result.calls.find(({ args }) => args[0] === "update");
    expect(update.otaVersion).toBe("2.1.11");
    expect(update.args).toContain("2.1.11 · Fix giving link");
  });

  it("ignores an OTA version left in the shell", () => {
    const result = runFixture(["--message", "Fix", "--platform", "ios"], {
      env: { HCCNA_OTA_VERSION: "9.9.9" },
    });
    expect(result.status).toBe(0);
    expect(
      result.calls
        .filter(({ command }) => command === "eas")
        .map(({ args, otaVersion }) => [args[0], otaVersion]),
    ).toEqual([
      ["env:exec", undefined],
      ["update:list", undefined],
      ["update", "2.1.1"],
    ]);
  });

  it("reads every page of published updates", () => {
    const updates = Array.from({ length: 51 }, (_, index) => ({
      message: `2.1.${index + 1} · Update ${index + 1}`,
      isRollBackToEmbedded: false,
    }));
    const result = runFixture(["--check"], { updates });
    expect(result.status).toBe(0);
    expect(
      result.calls
        .filter(({ args }) => args[0] === "update:list")
        .map(({ args }) => args.at(-1)),
    ).toEqual(["0", "50"]);
    expect(result.stdout).toContain("Next OTA version: 2.1.52");
  });

  it("fails before publishing when EAS returns an unreadable update list", () => {
    const result = runFixture(["--message", "Fix", "--platform", "ios"], {
      invalidUpdateList: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "EAS did not return a valid update list; eas-cli's output may have changed.",
    );
    expect(commands(result)).toContain("update:list");
    expect(commands(result)).not.toContain("update");
  });

  it("writes the next version to the job summary without publishing", () => {
    const { result, summary } = withSummary((env) =>
      runFixture(["--check"], { env }),
    );
    expect(result.status).toBe(0);
    expect(commands(result)).not.toContain("update");
    expect(summary).toBe(
      "Next OTA version: **2.1.1** (all). Nothing was published.\n",
    );
  });

  it("writes the published version to the job summary", () => {
    const { result, summary } = withSummary((env) =>
      runFixture(["--message", "Fix", "--platform", "ios"], { env }),
    );
    expect(result.status).toBe(0);
    expect(summary).toBe("Published **2.1.1 · Fix** (ios).\n");
  });

  it("refuses to publish without a message", () => {
    const result = runFixture(["--platform", "ios"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Pass --message "..." to describe the update.',
    );
    expect(result.calls).toEqual([]);
  });

  it("refuses a store version that predates the scheme before reading EAS", () => {
    const result = runFixture(["--check"], {
      nativeVersion: { version: "2.0.1", androidVersionCode: 23 },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("predates the versioning scheme");
    expect(result.calls).toEqual([]);
  });
});
