import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "https://github.com/Effect-TS/effect.git";
const markerName = ".hccnj-reference.json";

async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return undefined;
		throw error;
	}
}

function cloneEffect(tag, destination) {
	const options = {
		encoding: "utf8",
		timeout: 120_000,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
	};
	execFileSync(
		"git",
		[
			"-c",
			"advice.detachedHead=false",
			"clone",
			"--quiet",
			"--depth",
			"1",
			"--single-branch",
			"--branch",
			tag,
			repository,
			destination,
		],
		options,
	);
	return execFileSync("git", ["-C", destination, "rev-parse", "HEAD"], options).trim();
}

export function shouldSkipEffectSync(env) {
	const enabled = (value) => Boolean(value && value !== "0" && value !== "false");
	return (
		enabled(env.SKIP_EFFECT_REPO_SYNC) ||
		enabled(env.CI) ||
		enabled(env.EAS_BUILD) ||
		env.NODE_ENV === "production"
	);
}

export async function syncEffectRepo(root, { clone = cloneEffect } = {}) {
	const manifest = await readJson(join(root, "package.json"));
	const version = manifest?.workspaces?.catalog?.effect;
	if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) {
		throw new Error("workspaces.catalog.effect must pin an exact release version");
	}
	const tag = `effect@${version}`;
	const refs = join(root, "repos");
	const target = join(refs, "effect");
	const marker = await readJson(join(target, markerName));
	const current = await readJson(join(target, "packages/effect/package.json"));
	if (
		marker?.tag === tag &&
		marker.repository === repository &&
		current?.version === version &&
		existsSync(join(target, "LLMS.md"))
	) {
		return { status: "current", version };
	}

	await mkdir(refs, { recursive: true });
	const lock = join(refs, ".effect-sync.lock");
	await mkdir(lock);
	let temporary;
	let preserveBackup = false;
	try {
		temporary = await mkdtemp(join(refs, ".effect-sync-"));
		const staged = join(temporary, "source");
		const backup = join(temporary, "previous");
		const commit = await clone(tag, staged);
		const downloaded = await readJson(join(staged, "packages/effect/package.json"));
		if (downloaded?.version !== version || !existsSync(join(staged, "LLMS.md"))) {
			throw new Error(`Downloaded ${tag} does not contain the expected Effect source`);
		}
		await rm(join(staged, ".git"), { recursive: true, force: true });
		await writeFile(
			join(staged, markerName),
			`${JSON.stringify({ repository, tag, version, commit }, null, 2)}\n`,
		);
		const hadReference = existsSync(target);
		if (hadReference) await rename(target, backup);
		try {
			await rename(staged, target);
		} catch (error) {
			if (hadReference) {
				// Keep the previous source on disk even if restoring its path fails.
				preserveBackup = true;
				await rename(backup, target);
				preserveBackup = false;
			}
			throw error;
		}
		return { status: "updated", version };
	} finally {
		if (temporary && !preserveBackup) await rm(temporary, { recursive: true, force: true });
		await rm(lock, { recursive: true, force: true });
	}
}

if (import.meta.main && !shouldSkipEffectSync(process.env)) {
	try {
		const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
		const result = await syncEffectRepo(root);
		console.log(`Effect reference ${result.status}: ${result.version}`);
	} catch (error) {
		console.error(`Effect reference sync failed: ${error.message}`);
		console.error(
			"Retry with bun run refs:sync, or set SKIP_EFFECT_REPO_SYNC=1 to install offline.",
		);
		process.exitCode = 1;
	}
}
