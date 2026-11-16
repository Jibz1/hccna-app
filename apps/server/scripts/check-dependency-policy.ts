import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The lockfile and overrides live at the monorepo root (bun only honors root
// overrides). Walk up from cwd to find it so this works from any workspace depth.
function findWorkspaceRoot(start: string): string {
	let dir = start;
	while (!existsSync(join(dir, "bun.lock"))) {
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error("dependency-policy: could not locate workspace root (bun.lock)");
		}
		dir = parent;
	}
	return dir;
}

const ROOT = process.cwd();
const WORKSPACE_ROOT = findWorkspaceRoot(ROOT);
const MANIFEST_PATH = join(ROOT, "package.json");
const WORKSPACE_ROOT_MANIFEST_PATH = join(WORKSPACE_ROOT, "package.json");
const LOCKFILE_PATH = join(WORKSPACE_ROOT, "bun.lock");
const ALLOWED_AXIOS_VERSION = "1.19.0";
const DISALLOWED_CHANNEL_SPECS = new Set(["latest", "beta", "next", "canary", "rc"]);
const DISALLOWED_PREFIXES = ["github:", "git:", "http:", "https:", "file:", "link:"];

interface PackageManifest {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	overrides?: Record<string, string>;
}

function fail(message: string): never {
	console.error(`dependency-policy: ${message}`);
	process.exit(1);
}

function readManifest(): PackageManifest {
	const manifest = readFileSync(MANIFEST_PATH, "utf8");
	return JSON.parse(manifest) as PackageManifest;
}

function parseLockfile(): string {
	const lockfile = readFileSync(LOCKFILE_PATH, "utf8");
	return lockfile;
}

function validateDependencySpecs(
	groupName: string,
	dependencies: Record<string, string> | undefined,
): void {
	if (!dependencies) {
		return;
	}

	for (const [name, spec] of Object.entries(dependencies)) {
		if (spec.startsWith("workspace:")) {
			const isAllowedInternalWorkspace = name.startsWith("@hccnj/") && spec === "workspace:*";

			if (!isAllowedInternalWorkspace) {
				fail(
					`${groupName}.${name} uses disallowed workspace spec "${spec}". Only @hccnj/* may use workspace:*`,
				);
			}
		} else {
			if (DISALLOWED_CHANNEL_SPECS.has(spec.toLowerCase())) {
				fail(`${groupName}.${name} uses disallowed version spec "${spec}"`);
			}

			if (spec.includes("*")) {
				fail(`${groupName}.${name} uses disallowed version spec "${spec}"`);
			}

			if (DISALLOWED_PREFIXES.some((prefix) => spec.toLowerCase().startsWith(prefix))) {
				fail(`${groupName}.${name} uses disallowed version spec "${spec}"`);
			}
		}
	}
}

function validateAxiosOverride(overrides: Record<string, string> | undefined): void {
	if (!overrides || overrides.axios !== ALLOWED_AXIOS_VERSION) {
		fail(`package.json must override axios to exactly "${ALLOWED_AXIOS_VERSION}"`);
	}
}

function validateAxiosVersions(lockfile: string): void {
	const versions = Array.from(
		lockfile.matchAll(/"(?:(?:[^"\n]+\/)?axios)":\s*\["axios@(?<version>[^"]+)"/gu),
		(match) => match.groups?.version,
	);

	if (versions.length === 0) {
		fail("bun.lock does not contain any resolved axios entries");
	}

	const disallowed = [...new Set(versions)].filter((version) => version !== ALLOWED_AXIOS_VERSION);

	if (disallowed.length > 0) {
		fail(`bun.lock resolves axios to disallowed version(s): ${disallowed.join(", ")}`);
	}
}

const manifest = readManifest();
const rootManifest = JSON.parse(
	readFileSync(WORKSPACE_ROOT_MANIFEST_PATH, "utf8"),
) as PackageManifest;
const lockfile = parseLockfile();

validateDependencySpecs("dependencies", manifest.dependencies);
validateDependencySpecs("devDependencies", manifest.devDependencies);
validateAxiosOverride(rootManifest.overrides);
validateAxiosVersions(lockfile);

console.log("dependency-policy: ok");
