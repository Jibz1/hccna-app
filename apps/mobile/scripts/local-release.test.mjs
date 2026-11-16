import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import {
  androidBuildGradle,
  envReporter,
  iosInfoPlist,
  runFixture,
  storeVersion,
} from "./release-fixtures.mjs";

// Cases spawn nested Bun and Node processes, which can exceed Vitest's 5s
// default while CI runs other packages' suites in parallel.
vi.setConfig({ testTimeout: 30_000 });

const args = ["run:ios", "--configuration", "Release", "--device"];
const XCODE_ENV_START =
  "# >>> release environment, written by bun run prebuild:release";

// Sources the generated file the way Xcode build phases do.
const sourceXcodeEnv = (directory, configuration) =>
  spawnSync(
    "bash",
    [
      "-c",
      'source ios/.xcode.env.local && printf "%s|%s|%s" "$MMKV_ENCRYPTION_KEY" "$HCCNA_RELEASE_ENV" "$EXPO_NO_DOTENV"',
    ],
    {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH, CONFIGURATION: configuration },
    },
  );

it("refuses a local Release before running Expo when the release file has no key", () => {
  const result = runFixture(args, { localRelease: true, files: {} });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("requires MMKV_ENCRYPTION_KEY");
  expect(result.stdout).toBe("");
});

it("rejects a local Release carrying a different storage key", () => {
  const result = runFixture(args, {
    localRelease: true,
    files: { ".env": "MMKV_ENCRYPTION_KEY=wrong-key\n" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("differs from the pinned store key");
  expect(result.stdout).toBe("");
});

it("loads explicit release values before Expo and blocks subsequent dotenv loading", () => {
  const result = runFixture(args, {
    localRelease: true,
    files: {
      ".env":
        "MMKV_ENCRYPTION_KEY=release-key\nEXPO_PUBLIC_API_URL=https://base.example.com\n",
      ".env.production": "EXPO_PUBLIC_API_URL=https://release.example.com\n",
      ".env.local":
        "MMKV_ENCRYPTION_KEY=developer-key\nEXPO_PUBLIC_DEVELOPER_ONLY=true\n",
    },
    env: {
      MMKV_ENCRYPTION_KEY: "shell-key",
      EXPO_PUBLIC_DEVELOPER_ONLY: "true",
      APP_VARIANT: "development",
    },
  });
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.args[0]).toMatch(/expo\/bin\/cli$/);
  expect(output.args.slice(1)).toEqual(args);
  expect(output).toMatchObject({
    profile: "production",
    mode: "production",
    variant: "production",
    dotenvDisabled: "1",
    releaseMarker: "1",
    key: "release-key",
    url: "https://release.example.com",
  });
  expect(output.developerValue).toBeUndefined();
});

it("prints shell exports that round-trip quoted release values", () => {
  const value = "it's a $(literal) value";
  const result = runFixture(["--print-shell-env"], {
    localRelease: true,
    files: {
      ".env": `MMKV_ENCRYPTION_KEY=release-key\nEXPO_PUBLIC_QUOTED="${value}"\n`,
      "ios/HCCNA/Info.plist": iosInfoPlist(storeVersion.version),
    },
  });
  expect(result.status).toBe(0);
  const evaluated = spawnSync(
    "bash",
    [
      "-c",
      'eval "$(cat)" && printf "%s|%s" "$EXPO_PUBLIC_QUOTED" "$HCCNA_RELEASE_ENV"',
    ],
    { input: result.stdout, encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  expect(evaluated.stdout).toBe(`${value}|1`);
});

it("makes Xcode Release builds of the prebuilt project load the release environment", () => {
  const result = runFixture(["prebuild", "--clean"], {
    localRelease: true,
    files: {
      ".env": "MMKV_ENCRYPTION_KEY=release-key\n",
      ".env.local": "MMKV_ENCRYPTION_KEY=developer-key\n",
      "ios/HCCNA/Info.plist": iosInfoPlist(storeVersion.version),
      "ios/.xcode.env.local": `export NODE_BINARY=/usr/bin/node\n${XCODE_ENV_START}\nstale block\n# <<< release environment\n`,
    },
    inspect: (directory) => ({
      file: readFileSync(join(directory, "ios", ".xcode.env.local"), "utf8"),
      release: sourceXcodeEnv(directory, "Release"),
      debug: sourceXcodeEnv(directory, "Debug"),
    }),
  });
  expect(result.status).toBe(0);
  const { file, release, debug } = result.inspected;
  expect(file.startsWith("export NODE_BINARY=/usr/bin/node\n")).toBe(true);
  expect(file.split(XCODE_ENV_START)).toHaveLength(2);
  expect(file).not.toContain("stale block");
  expect(release.status).toBe(0);
  expect(release.stdout).toBe("release-key|1|1");
  expect(debug.stdout).toBe("||");
});

it("fails Xcode Release builds when the release environment no longer loads", () => {
  const result = runFixture(["prebuild"], {
    localRelease: true,
    files: {
      ".env": "MMKV_ENCRYPTION_KEY=release-key\n",
      "ios/HCCNA/Info.plist": iosInfoPlist(storeVersion.version),
      "ios/.xcode.env.local": "export NODE_BINARY=/usr/bin/node\n",
    },
    inspect: (directory) => {
      spawnSync(
        "bash",
        ["-c", "printf 'MMKV_ENCRYPTION_KEY=wrong-key\\n' > .env"],
        {
          cwd: directory,
        },
      );
      return sourceXcodeEnv(directory, "Release");
    },
  });
  expect(result.status).toBe(0);
  expect(result.inspected.status).toBe(1);
  expect(result.inspected.stderr).toContain(
    "differs from the pinned store key",
  );
});

it("runs Gradle tasks in the Android project with the release environment", () => {
  const result = runFixture(["--gradle", "bundleRelease"], {
    localRelease: true,
    files: {
      ".env": "MMKV_ENCRYPTION_KEY=release-key\n",
      "android/app/build.gradle": androidBuildGradle(storeVersion),
    },
    executables: { "android/gradlew": envReporter },
  });
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.args).toEqual(["bundleRelease"]);
  expect(output.cwd).toMatch(/\/android$/);
  expect(output).toMatchObject({
    dotenvDisabled: "1",
    releaseMarker: "1",
    key: "release-key",
  });
});

it("stops an Android bundle whose generated project predates the version bump", () => {
  const result = runFixture(["--gradle", "bundleRelease"], {
    localRelease: true,
    files: {
      ".env": "MMKV_ENCRYPTION_KEY=release-key\n",
      "android/app/build.gradle": androidBuildGradle({
        version: "2.0.1",
        androidVersionCode: 23,
      }),
    },
    executables: { "android/gradlew": envReporter },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Native project is 2.0.1 (23) but native-version.js is 2.1.0 (24). Re-run `bun run generate--android-native-build`.",
  );
  expect(result.stdout).toBe("");
});

it("asks for a prebuild when the generated Android project is missing", () => {
  const result = runFixture(["--gradle", "bundleRelease"], {
    localRelease: true,
    files: { ".env": "MMKV_ENCRYPTION_KEY=release-key\n" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Cannot find android/app/build.gradle. Run `bun run generate--android-native-build` first.",
  );
});

it("stops an Xcode Release build whose Info.plist predates the version bump", () => {
  const result = runFixture(["--print-shell-env"], {
    localRelease: true,
    files: {
      ".env": "MMKV_ENCRYPTION_KEY=release-key\n",
      "ios/HCCNA/Info.plist": iosInfoPlist("2.0.1"),
    },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "error: Native project is 2.0.1 but native-version.js is 2.1.0. Re-run `bun run prebuild:release`.",
  );
  expect(result.stdout).toBe("");
});

it("names the value Xcode would use when Info.plist holds a build setting", () => {
  const result = runFixture(["--print-shell-env"], {
    localRelease: true,
    files: {
      ".env": "MMKV_ENCRYPTION_KEY=release-key\n",
      "ios/HCCNA/Info.plist": iosInfoPlist("$(MARKETING_VERSION)"),
    },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Native project is $(MARKETING_VERSION) but native-version.js is 2.1.0.",
  );
});
