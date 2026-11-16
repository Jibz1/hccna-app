import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { runFixture } from "./release-fixtures.mjs";

vi.setConfig({ testTimeout: 30_000 });

const signing =
  "MYAPP_UPLOAD_STORE_FILE=release.keystore\nMYAPP_UPLOAD_KEY_ALIAS=release-alias\nMYAPP_UPLOAD_STORE_PASSWORD=release-store-password\nMYAPP_UPLOAD_KEY_PASSWORD=release-key-password\n";
const appBuildGradle = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

const generate = (files, env) =>
  runFixture([], {
    script: "generate-android-native-build.ts",
    localRelease: true,
    files: {
      "android/gradle.properties": "org.gradle.jvmargs=-Xmx2048m\n",
      "android/app/build.gradle": appBuildGradle,
      ...files,
    },
    env,
    inspect: (directory) => ({
      properties: readFileSync(
        join(directory, "android", "gradle.properties"),
        "utf8",
      ),
      gradle: readFileSync(
        join(directory, "android", "app", "build.gradle"),
        "utf8",
      ),
    }),
  });

it("prebuilds only Android with the release files and their signing values", () => {
  const result = generate(
    {
      ".env": `MMKV_ENCRYPTION_KEY=release-key\n${signing}`,
      ".env.local":
        "MMKV_ENCRYPTION_KEY=developer-key\nMYAPP_UPLOAD_STORE_PASSWORD=developer-password\n",
    },
    { MYAPP_UPLOAD_KEY_PASSWORD: "shell-password", APP_VARIANT: "development" },
  );
  expect(result.status).toBe(0);
  const prebuild = JSON.parse(
    result.stdout.split("\n").find((line) => line.startsWith("{")),
  );
  expect(prebuild.args.slice(1)).toEqual(["prebuild", "--platform", "android"]);
  expect(prebuild).toMatchObject({
    key: "release-key",
    releaseMarker: "1",
    dotenvDisabled: "1",
    variant: "production",
  });
  const { properties, gradle } = result.inspected;
  expect(properties).toContain(
    "MYAPP_UPLOAD_STORE_PASSWORD=release-store-password",
  );
  expect(properties).toContain(
    "MYAPP_UPLOAD_KEY_PASSWORD=release-key-password",
  );
  expect(properties).not.toContain("developer-password");
  expect(properties).not.toContain("shell-password");
  expect(gradle).toContain("signingConfig signingConfigs.release");
});

it("refuses to prebuild with a storage key that differs from the pin", () => {
  const result = generate({
    ".env": `MMKV_ENCRYPTION_KEY=other-key\n${signing}`,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("differs from the pinned store key");
  expect(result.stdout).toBe("");
});

it("names signing values missing from the release files, even when the shell has them", () => {
  const result = generate(
    { ".env": "MMKV_ENCRYPTION_KEY=release-key\n" },
    {
      MYAPP_UPLOAD_STORE_FILE: "shell.keystore",
      MYAPP_UPLOAD_KEY_ALIAS: "shell-alias",
      MYAPP_UPLOAD_STORE_PASSWORD: "shell-store-password",
      MYAPP_UPLOAD_KEY_PASSWORD: "shell-key-password",
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Release environment files are missing Android signing value(s): MYAPP_UPLOAD_STORE_FILE",
  );
  expect(result.stdout).toBe("");
});
