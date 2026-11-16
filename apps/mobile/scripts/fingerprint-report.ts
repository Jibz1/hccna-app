import { appendFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { createFingerprintAsync, diffFingerprints } from "expo/fingerprint";

interface FingerprintSourceEntry {
  readonly type: string;
  readonly filePath?: string;
  readonly id?: string;
}

export interface FingerprintDiffEntry {
  readonly op: "added" | "removed" | "changed";
  readonly addedSource?: FingerprintSourceEntry;
  readonly removedSource?: FingerprintSourceEntry;
  readonly afterSource?: FingerprintSourceEntry;
}

export interface FingerprintReport {
  readonly summary: string;
  readonly warning?: string;
}

const WARNING =
  "This PR changes native code, so it can't ship as an OTA update. Release it with `bun run version:bump store` and a store build.";

export function fingerprintReport(
  diff: readonly FingerprintDiffEntry[],
): FingerprintReport {
  if (diff.length === 0) {
    return { summary: "No native changes: this can ship as an OTA update." };
  }
  const lines = diff.map((item) => {
    const source = item.addedSource ?? item.removedSource ?? item.afterSource;
    return `- ${item.op}: ${source?.filePath ?? source?.id ?? "unknown source"}`;
  });
  return {
    warning: WARNING,
    summary: ["**Native changes**", "", WARNING, "", ...lines].join("\n"),
  };
}

async function main(args: readonly string[]) {
  const [baseRoot, headRoot] = args;
  if (baseRoot === undefined || headRoot === undefined) {
    throw new Error(
      "Usage: bun scripts/fingerprint-report.ts <base project> <head project>",
    );
  }
  // Each project hashes with its own fingerprint.config.js. Resolve symlinks
  // (macOS /tmp) so the config loader's relative paths match the project root.
  const base = await createFingerprintAsync(realpathSync(resolve(baseRoot)));
  const head = await createFingerprintAsync(realpathSync(resolve(headRoot)));
  const report = fingerprintReport(diffFingerprints(base, head));
  if (report.warning) {
    console.log(`::warning title=Native change::${report.warning}`);
  }
  console.log(report.summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report.summary}\n`);
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
