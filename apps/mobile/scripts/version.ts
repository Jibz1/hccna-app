import { PROJECT_ROOT } from "./releaseEnv";
import {
  bumpStoreVersion,
  readStoreVersion,
  writeStoreVersion,
  type BumpKind,
} from "./versioning";

const KINDS: readonly BumpKind[] = ["store", "major"];
const isBumpKind = (value: string | undefined): value is BumpKind =>
  KINDS.some((kind) => kind === value);

try {
  const [kind, ...rest] = process.argv.slice(2);
  if (!isBumpKind(kind) || rest.length > 0) {
    throw new Error("Usage: bun run version:bump store|major");
  }
  const current = readStoreVersion(PROJECT_ROOT);
  const next = bumpStoreVersion(current, kind);
  writeStoreVersion(PROJECT_ROOT, next);
  console.log(
    [
      `native-version.js: ${current.version} (${current.androidVersionCode}) → ${next.version} (${next.androidVersionCode})`,
      "Next:",
      "1. Open a PR with native-version.js and merge it.",
      "2. iOS: bun run prebuild:release, then archive in Xcode.",
      "3. Android: bun run generate--android-native-build, then bun run android:bundle.",
      "4. Record the release in ota-release.json.",
    ].join("\n"),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
