import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadReleaseEnv,
  PROJECT_ROOT,
  productionEnv,
  run,
  withoutUpdateValues,
} from "./releaseEnv";
import {
  assertAndroidProjectCurrent,
  assertIosProjectCurrent,
  readStoreVersion,
} from "./versioning";

const XCODE_ENV_START =
  "# >>> release environment, written by bun run prebuild:release";
const XCODE_ENV_END = "# <<< release environment";

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

// Prints the release environment for Xcode build phases to evaluate.
function printShellEnv() {
  const env = productionEnv(loadReleaseEnv());
  // Xcode is about to bundle and archive this project.
  try {
    assertIosProjectCurrent(PROJECT_ROOT, readStoreVersion(PROJECT_ROOT));
  } catch (error) {
    // Xcode surfaces only the lines of build-phase output that start with this.
    throw new Error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Cannot export ${name} to Xcode build phases.`);
    }
    if (value !== undefined) {
      console.log(`export ${name}=${shellQuote(value)}`);
    }
  }
}

// Every React Native and Expo build phase sources ios/.xcode.env.local, so
// Release archives started from Xcode load the release files at build time.
function writeXcodeReleaseEnv() {
  const iosRoot = join(PROJECT_ROOT, "ios");
  if (!existsSync(iosRoot)) {
    return;
  }
  const path = join(iosRoot, ".xcode.env.local");
  const kept: string[] = [];
  let inBlock = false;
  for (const line of existsSync(path)
    ? readFileSync(path, "utf8").split("\n")
    : []) {
    if (line === XCODE_ENV_START) {
      inBlock = true;
    } else if (line === XCODE_ENV_END) {
      inBlock = false;
    } else if (!inBlock) {
      kept.push(line);
    }
  }
  const command = [
    process.execPath,
    "--no-env-file",
    fileURLToPath(import.meta.url),
    "--print-shell-env",
  ]
    .map(shellQuote)
    .join(" ");
  const block = [
    XCODE_ENV_START,
    'case "$CONFIGURATION" in',
    '  "" | *Debug*) ;;',
    "  *)",
    `    HCCNA_RELEASE_SHELL_ENV="$(${command})" || {`,
    '      echo "error: Could not load the release environment; see docs/ota-updates.md." >&2',
    "      exit 1",
    "    }",
    '    eval "$HCCNA_RELEASE_SHELL_ENV"',
    "    ;;",
    "esac",
    XCODE_ENV_END,
  ];
  const preserved = kept.join("\n").trim();
  writeFileSync(
    path,
    `${preserved ? `${preserved}\n` : ""}${block.join("\n")}\n`,
  );
  console.error(
    "Xcode Release builds of this ios/ project now load the release environment.",
  );
}

try {
  const args = process.argv.slice(2);
  if (args[0] === "--print-shell-env" && args.length === 1) {
    printShellEnv();
  } else {
    // Expo reads config while parsing CLI options, before loading .env itself.
    // Invoke Node directly so Bun cannot reload developer-local files either.
    const env = productionEnv({
      ...withoutUpdateValues(),
      ...loadReleaseEnv(),
    });
    if (args[0] === "--gradle") {
      assertAndroidProjectCurrent(PROJECT_ROOT, readStoreVersion(PROJECT_ROOT));
      const androidRoot = join(PROJECT_ROOT, "android");
      run(join(androidRoot, "gradlew"), args.slice(1), {
        env,
        cwd: androidRoot,
      });
    } else {
      run(
        "node",
        [fileURLToPath(import.meta.resolve("expo/bin/cli")), ...args],
        { env },
      );
      if (args[0] === "prebuild") {
        writeXcodeReleaseEnv();
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
