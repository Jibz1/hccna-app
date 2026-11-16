import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { runFixture } from "./release-fixtures.mjs";
import {
  bumpStoreVersion,
  formatNativeVersionFile,
  nextOtaVersion,
  otaMessage,
  parseVersion,
  readStoreVersion,
  storeReleaseParts,
} from "./versioning";

vi.setConfig({ testTimeout: 30_000 });

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const readVersionFile = (directory) =>
  readFileSync(join(directory, "native-version.js"), "utf8");

describe("store versions", () => {
  it("parses MAJOR.STORE.OTA and rejects anything else", () => {
    expect(parseVersion("2.10.3")).toEqual([2, 10, 3]);
    for (const version of ["2.1", "v2.1.0", "2.1.0-beta", "02.1.0", ""]) {
      expect(() => parseVersion(version)).toThrow(
        `${version} is not a MAJOR.STORE.OTA version`,
      );
    }
  });

  it("bumps the store or major number and the Android version code", () => {
    const current = { version: "2.0.1", androidVersionCode: 23 };
    expect(bumpStoreVersion(current, "store")).toEqual({
      version: "2.1.0",
      androidVersionCode: 24,
    });
    expect(
      bumpStoreVersion({ version: "2.4.0", androidVersionCode: 30 }, "major"),
    ).toEqual({ version: "3.0.0", androidVersionCode: 31 });
  });

  it("keeps the committed native-version.js in its generated form", () => {
    expect(readFileSync(join(appRoot, "native-version.js"), "utf8")).toBe(
      formatNativeVersionFile(readStoreVersion(appRoot)),
    );
  });
});

describe("version:bump", () => {
  it("writes the next store release and prints the next steps", () => {
    const result = runFixture(["store"], {
      script: "version.ts",
      inspect: readVersionFile,
    });
    expect(result.status).toBe(0);
    expect(result.inspected).toBe(
      formatNativeVersionFile({ version: "2.2.0", androidVersionCode: 25 }),
    );
    expect(result.stdout).toContain("2.1.0 (24) → 2.2.0 (25)");
    expect(result.stdout).toContain("bun run generate--android-native-build");
  });

  it("writes the next major release", () => {
    const result = runFixture(["major"], {
      script: "version.ts",
      inspect: readVersionFile,
    });
    expect(result.status).toBe(0);
    expect(result.inspected).toBe(
      formatNativeVersionFile({ version: "3.0.0", androidVersionCode: 25 }),
    );
  });

  it("rejects other bump kinds without touching the file", () => {
    const result = runFixture(["minor"], {
      script: "version.ts",
      inspect: readVersionFile,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: bun run version:bump store|major");
    expect(result.inspected).toBe(
      formatNativeVersionFile({ version: "2.1.0", androidVersionCode: 24 }),
    );
  });

  it("names native-version.js when it was edited into an invalid shape", () => {
    const result = runFixture(["store"], {
      script: "version.ts",
      nativeVersion: { version: "2.1", androidVersionCode: 24 },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'native-version.js must export { version: "X.Y.Z", androidVersionCode: N }',
    );
  });
});

describe("OTA version numbers", () => {
  const group = (message, isRollBackToEmbedded = false) => ({
    message,
    isRollBackToEmbedded,
  });

  it("starts at .1 and counts past two digits numerically", () => {
    expect(nextOtaVersion("2.1.0", [])).toBe("2.1.1");
    expect(
      nextOtaVersion("2.1.0", [
        group("2.1.9 · Ninth"),
        group("2.1.10 · Tenth"),
      ]),
    ).toBe("2.1.11");
  });

  it("ignores rollbacks, other store releases, and unprefixed messages", () => {
    expect(
      nextOtaVersion("2.1.0", [
        group("2.1.2 · Counted"),
        group("2.1.7 · Rolled back", true),
        group("2.10.4 · Another store release"),
        group("2.0.9 · Older store release"),
        group("v2.1.5 · Not a prefix"),
        group("2.1.6· Missing space"),
        group("OTA test"),
        group(null),
        { isRollBackToEmbedded: false },
      ]),
    ).toBe("2.1.3");
  });

  it("reads the prefix inside the quoted messages eas-cli lists", () => {
    expect(
      nextOtaVersion("2.1.0", [
        group('"2.1.1 · First" (2 hours ago by Ada Example)'),
        group('"2.1.2 · Second" (1 hour ago by Ada Example)'),
        group("(1 hour ago by Ada Example)"),
      ]),
    ).toBe("2.1.3");
  });

  it("refuses a store version that predates the scheme", () => {
    expect(() => storeReleaseParts("2.0.1")).toThrow(
      "native-version.js is 2.0.1, which predates the versioning scheme. Run `bun run version:bump store` first.",
    );
    expect(storeReleaseParts("2.1.0")).toEqual([2, 1]);
  });

  it("prefixes messages with the version", () => {
    expect(otaMessage("2.1.3", "Fix giving link")).toBe(
      "2.1.3 · Fix giving link",
    );
  });
});
