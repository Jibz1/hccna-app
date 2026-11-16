import { existsSync } from "node:fs";
import { join } from "node:path";

// Re-applies the Effect language service patch to the TypeScript 7 native binary
// (@typescript/native) after every install, since installs restore the original.
// Skipped in production images, where devDependencies are not installed.
const bin = join(process.cwd(), "node_modules", ".bin", "effect-tsgo");

if (existsSync(bin)) {
	const result = Bun.spawnSync([bin, "patch"], { stdout: "inherit", stderr: "inherit" });
	process.exit(result.exitCode ?? 1);
}
