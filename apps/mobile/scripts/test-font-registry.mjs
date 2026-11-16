import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("Font registry native stress test requires macOS and Xcode.");
  process.exit(0);
}
const require = createRequire(import.meta.url);
const source = join(
  dirname(require.resolve("expo-font/package.json")),
  "ios/FontRegistry.swift",
);
const directory = mkdtempSync(join(tmpdir(), "font-registry-"));
try {
  const binary = join(directory, "stress");
  execFileSync(
    "xcrun",
    [
      "swiftc",
      "-sanitize=thread",
      "-o",
      binary,
      source,
      fileURLToPath(new URL("FontRegistryStress.swift", import.meta.url)),
    ],
    { stdio: "inherit" },
  );
  execFileSync(binary, {
    stdio: "inherit",
    env: { ...process.env, TSAN_OPTIONS: "halt_on_error=1" },
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
