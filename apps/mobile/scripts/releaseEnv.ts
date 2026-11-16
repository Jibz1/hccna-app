import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnvFiles } from "@expo/env";
import { Schema } from "effect";

export const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
// Set only in environments built from the explicit release files below.
// app.config.ts refuses store bundles without it.
export const RELEASE_ENV_MARKER = "HCCNA_RELEASE_ENV";
// Stored in the EAS production environment. When EAS supplies it, app.config.ts
// requires the pinned key, so `eas update` checks the values it publishes.
export const KEY_REQUIRED_VARIABLE = "MMKV_ENCRYPTION_KEY_REQUIRED";
export const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export const RuntimeVersion = Schema.String.check(Schema.isMinLength(1));
export const RuntimeVersions = Schema.Struct({
  ios: Schema.NullOr(RuntimeVersion),
  android: Schema.NullOr(RuntimeVersion),
});
export const UpdateValueHashes = Schema.Record(Schema.String, Sha256).check(
  Schema.isPropertyNames(
    Schema.String.check(
      Schema.isPattern(/^(MMKV_ENCRYPTION_KEY|APPLE_TEAM_ID|EXPO_PUBLIC_.+)$/),
    ),
  ),
);
const StoreRelease = Schema.fromJsonString(
  Schema.Struct({
    mmkvKeySha256: Sha256,
    updateValuesSha256: Schema.NullOr(UpdateValueHashes),
    runtimeVersions: RuntimeVersions,
  }),
);
type StoreRelease = typeof StoreRelease.Type;

export function readStoreRelease(): StoreRelease {
  const release = Schema.decodeUnknownSync(StoreRelease)(
    readFileSync(join(PROJECT_ROOT, "ota-release.json"), "utf8"),
  );
  if (
    release.updateValuesSha256 &&
    release.updateValuesSha256.MMKV_ENCRYPTION_KEY !== release.mmkvKeySha256
  ) {
    throw new Error(
      "ota-release.json updateValuesSha256 must record MMKV_ENCRYPTION_KEY with the pinned mmkvKeySha256.",
    );
  }
  return release;
}

// The bundle never reads APPLE_TEAM_ID, but app.config.ts copies it into
// ios.appleTeamId, which the runtime fingerprint hashes. EAS must evaluate the
// same config as the store build, or every OTA targets another runtime.
export const isUpdateValue = (name: string) =>
  name === "MMKV_ENCRYPTION_KEY" ||
  name === "APPLE_TEAM_ID" ||
  name.startsWith("EXPO_PUBLIC_");

export const updateValues = (env: Record<string, string | undefined>) =>
  Object.entries(env).flatMap(([name, value]) =>
    isUpdateValue(name) && value ? [[name, value] as const] : [],
  );

export const hashUpdateValues = (env: Record<string, string | undefined>) =>
  new Map(
    updateValues(env)
      .map(
        ([name, value]) =>
          [name, createHash("sha256").update(value).digest("hex")] as const,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );

export function assertStoreKey(
  hashes: Map<string, string>,
  source: string,
  release: StoreRelease,
) {
  if (!hashes.has("MMKV_ENCRYPTION_KEY")) {
    throw new Error(
      `${source} requires MMKV_ENCRYPTION_KEY from the store release.`,
    );
  }
  if (hashes.get("MMKV_ENCRYPTION_KEY") !== release.mmkvKeySha256) {
    throw new Error(
      `${source} MMKV_ENCRYPTION_KEY differs from the pinned store key in ota-release.json. Refusing to change users' storage key.`,
    );
  }
  return hashes;
}

// Highest priority first. Do not expand values using the invoking shell, which
// may already contain Bun's automatically loaded developer-local overrides.
export function loadReleaseEnv(release = readStoreRelease()) {
  // EXPO_NO_DOTENV turns off Expo's implicit loading, and @expo/env applies it
  // to every parse. This loader is the explicit selection, so it must still read.
  const noDotenv = process.env.EXPO_NO_DOTENV;
  delete process.env.EXPO_NO_DOTENV;
  let parsed: ReturnType<typeof parseEnvFiles>;
  try {
    parsed = parseEnvFiles(
      [".env.production", ".env"].map((name) => join(PROJECT_ROOT, name)),
      { systemEnv: {} },
    );
  } finally {
    if (noDotenv !== undefined) {
      process.env.EXPO_NO_DOTENV = noDotenv;
    }
  }
  console.error(
    `Release environment files (highest priority first): ${parsed.files.map((file) => basename(file)).join(", ") || "none"}. .env*.local files are excluded.`,
  );
  assertStoreKey(
    hashUpdateValues(parsed.env),
    "Local release environment",
    release,
  );
  return parsed.env;
}

export const withoutUpdateValues = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !isUpdateValue(name)),
  );

// Prevent Expo from loading .env.local after our explicit release file selection.
export const productionEnv = (env: Record<string, string | undefined>) => ({
  ...env,
  NODE_ENV: "production",
  APP_VARIANT: "production",
  EAS_BUILD_PROFILE: "production",
  EXPO_NO_DOTENV: "1",
  [RELEASE_ENV_MARKER]: "1",
});

const redact = (text: string, secrets: readonly string[]) =>
  secrets
    .filter((secret) => secret.length > 0)
    .reduce((output, secret) => output.replaceAll(secret, "[redacted]"), text);

export function run(
  command: string,
  args: string[],
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    captureStdout?: boolean;
    quiet?: boolean;
    redact?: readonly string[];
  } = {},
) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: [
      "inherit",
      options.captureStdout || options.quiet ? "pipe" : "inherit",
      options.quiet ? "pipe" : "inherit",
    ],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const exit = result.signal
      ? `was terminated by ${result.signal}`
      : `exited with ${result.status}`;
    // Quiet commands receive secret values, so their diagnostics are redacted.
    const detail = options.quiet
      ? redact(
          `${result.stderr ?? ""}${result.stdout ?? ""}`,
          options.redact ?? [],
        ).trim()
      : "";
    throw new Error(
      `${command} ${args[0]} ${exit}${detail ? `:\n${detail}` : ""}`,
    );
  }
  return result.stdout ?? "";
}
