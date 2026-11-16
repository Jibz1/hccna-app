#!/usr/bin/env bun
/**
 * Reads the bench Redis's command counters and key counts, so a run can be checked against what
 * the servers actually did. Both servers share this Redis and Redis counts the same way for both,
 * which makes it the one source that works for the TS and the Rust server alike (the TS server
 * only reports Strapi, CCB and Castr in its own /metrics).
 *
 *   BENCH_REDIS_URL="$(railway variables --service hccna-bench-redis --json | jq -r .REDIS_PUBLIC_URL)" \
 *     bun apps/server-rs/bench/redis-stats.ts snapshot --label=before > "$TMPDIR/bench/before.json"
 *   ... run the scenario ...
 *   BENCH_REDIS_URL=... bun apps/server-rs/bench/redis-stats.ts snapshot --label=after > "$TMPDIR/bench/after.json"
 *   bun apps/server-rs/bench/redis-stats.ts delta "$TMPDIR/bench/before.json" "$TMPDIR/bench/after.json" --requests=<GraphQL requests of the run>
 *
 * It is read-only (INFO commandstats, DBSIZE, SCAN) and refuses a URL that points at the
 * production Redis (k6/guard.js). The URL carries the password, so pass it through the
 * environment from the command substitution above, never typed inline, and nothing here prints it.
 * The same numbers are available by hand in the `railway connect hccna-bench-redis` session:
 * `INFO commandstats`, `DBSIZE`, and `redis-cli --scan --pattern 'rs:graphql:response-cache:result:v2:*'`.
 *
 * Reading the numbers (calibrated against the TS code and the Rust spec):
 *  - `incr` is the per-request rate limiter, so its delta is about the number of GraphQL requests
 *    the server handled in the window. If it is not, the window is not the run.
 *  - warm: `setex` is a small constant, not proportional to requests (the before-snapshot precedes
 *    the k6 deployment, so the window includes the priming pass; tens to a few hundred writes, more
 *    on TS); `get` then grows only by about one per cache key per 30 s, the in-process tier's TTL
 *    cap.
 *  - resolver: compare new response-cache entries, not command counts. Each server's
 *    `...response-cache:result:v2:*` count (TS without a prefix, Rust under `rs:`) grows by about
 *    80% of the requests (sermon and campuses requests always miss). Rust `rs:*` grows more, about
 *    125%, because it also holds the record-cache entries (one per sermon request, about 45%).
 *    TS `setex`, `get` and `ttl` are inflated by design (an entity-index entry per entity in each
 *    response, a TTL read per request), so do not compare them across servers.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { assertAllowedUrl } from "./k6/guard.js";

export interface CommandStat {
	calls: number;
	usec: number;
}
export interface Snapshot {
	type: "redis";
	label: string;
	at: string;
	atMs: number;
	dbsize: number;
	commands: Record<string, CommandStat>;
	keys: Record<string, number>;
}

/**
 * Key patterns counted by default. The Rust server prefixes every key with `rs:` and the TS server
 * uses none, so each cache layer has one pattern per server. Response-cache entries are the
 * comparable count across servers: `rs:*` alone also matches the Rust record cache, core, VOD and
 * CCB entries and the rate-limit keys, so it is a total, not a response-entry count.
 */
export const DEFAULT_PATTERNS = [
	// Response-cache entries: the cross-server hit/miss count (TS, then Rust).
	"graphql:response-cache:result:v2:*",
	"rs:graphql:response-cache:result:v2:*",
	// The TS entity index, which the Rust server does not port.
	"graphql:response-cache:entity:v2:*",
	// Strapi record cache (TS, then Rust).
	"cms-v5:*",
	"rs:cms-v5:*",
	"graphql:rate-limit:*",
	// Everything the Rust server wrote.
	"rs:*",
];

/** Commands that carry the comparison; others with a non-zero delta are listed after them. */
const CORE_COMMANDS = ["incr", "setex", "get", "mget", "set", "expire", "ttl", "del"];
// This tool's own traffic and connection handshakes.
const NOISE_COMMANDS = new Set(["info", "scan", "dbsize", "hello", "client", "auth", "command", "select", "ping"]);

/** Parses the body of `INFO commandstats` into calls and microseconds per command. */
export function parseCommandStats(text: string): Record<string, CommandStat> {
	const stats: Record<string, CommandStat> = {};
	for (const line of text.split(/\r?\n/u)) {
		const match = /^cmdstat_([a-z0-9_|]+):calls=(\d+),usec=(\d+)/iu.exec(line.trim());
		if (match?.[1] && match[2] && match[3]) {
			stats[match[1].toLowerCase()] = { calls: Number(match[2]), usec: Number(match[3]) };
		}
	}
	return stats;
}

export interface Delta {
	type: "redis-delta";
	seconds: number;
	dbsize: { before: number; after: number; delta: number };
	commands: Record<string, number>;
	keys: Record<string, number>;
	perRequest?: Record<string, number>;
	counterReset: boolean;
}

/** What changed between two snapshots of the same Redis. */
export function deltaOf(before: Snapshot, after: Snapshot, requests?: number): Delta {
	let counterReset = false;
	const commands: Record<string, number> = {};
	for (const name of new Set([...Object.keys(before.commands), ...Object.keys(after.commands)])) {
		const change = (after.commands[name]?.calls ?? 0) - (before.commands[name]?.calls ?? 0);
		if (change < 0) counterReset = true;
		if (CORE_COMMANDS.includes(name) || (change !== 0 && !NOISE_COMMANDS.has(name))) {
			commands[name] = change;
		}
	}
	const keys: Record<string, number> = {};
	for (const pattern of new Set([...Object.keys(before.keys), ...Object.keys(after.keys)])) {
		keys[pattern] = (after.keys[pattern] ?? 0) - (before.keys[pattern] ?? 0);
	}
	const result: Delta = {
		type: "redis-delta",
		seconds: Math.round((after.atMs - before.atMs) / 100) / 10,
		dbsize: { before: before.dbsize, after: after.dbsize, delta: after.dbsize - before.dbsize },
		commands: Object.fromEntries(
			Object.entries(commands).sort(([a], [b]) => orderOf(a) - orderOf(b) || a.localeCompare(b)),
		),
		keys,
		counterReset,
	};
	if (requests !== undefined && requests > 0) {
		result.perRequest = Object.fromEntries(
			CORE_COMMANDS.map((name) => [name, Math.round(((commands[name] ?? 0) / requests) * 1000) / 1000]),
		);
	}
	return result;
}

function orderOf(name: string): number {
	const index = CORE_COMMANDS.indexOf(name);
	return index === -1 ? CORE_COMMANDS.length : index;
}

async function takeSnapshot(url: string, label: string, patterns: string[]): Promise<Snapshot> {
	const client = new Bun.RedisClient(url);
	try {
		await client.connect();
		const commands = parseCommandStats(String(await client.send("INFO", ["commandstats"])));
		const dbsize = Number(await client.send("DBSIZE", []));
		const keys: Record<string, number> = {};
		for (const pattern of patterns) {
			let cursor = "0";
			let count = 0;
			do {
				const [next, batch] = (await client.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "1000"])) as [
					string,
					string[],
				];
				cursor = String(next);
				count += batch.length;
			} while (cursor !== "0");
			keys[pattern] = count;
		}
		const now = new Date();
		return { type: "redis", label, at: now.toISOString(), atMs: now.getTime(), dbsize, commands, keys };
	} finally {
		client.close();
	}
}

function option(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function fail(message: string): never {
	console.error(message);
	process.exit(2);
}

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	if (command === "snapshot") {
		const url = process.env.BENCH_REDIS_URL;
		if (!url) fail("BENCH_REDIS_URL is not set (see RUNBOOK.md, 'Check the cache behaviour')");
		try {
			assertAllowedUrl(url, "BENCH_REDIS_URL");
		} catch (error) {
			fail(error instanceof Error ? error.message : "refused target");
		}
		const extra = process.argv.filter((arg) => arg.startsWith("--pattern=")).map((arg) => arg.slice(10));
		let snapshot: Snapshot;
		try {
			snapshot = await takeSnapshot(url, option("label") ?? "snapshot", extra.length > 0 ? extra : DEFAULT_PATTERNS);
		} catch (error) {
			// The connection error may echo the URL, which holds the password: print only its name.
			fail(`could not read the bench Redis: ${error instanceof Error ? error.name : "unknown error"}`);
		}
		const line = JSON.stringify(snapshot);
		const out = option("out");
		if (out) {
			mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
			writeFileSync(out, `${line}\n`, { mode: 0o600 });
		}
		console.log(line);
	} else if (command === "delta") {
		const [beforePath, afterPath] = rest.filter((arg) => !arg.startsWith("--"));
		if (!beforePath || !afterPath) fail("usage: redis-stats.ts delta BEFORE.json AFTER.json [--requests=N]");
		const read = (path: string) => JSON.parse(readFileSync(path, "utf8").trim().split("\n")[0] ?? "") as Snapshot;
		const requests = option("requests");
		console.log(JSON.stringify(deltaOf(read(beforePath), read(afterPath), requests ? Number(requests) : undefined)));
	} else {
		fail("usage: BENCH_REDIS_URL=... redis-stats.ts snapshot [--label=L] [--out=FILE] [--pattern=GLOB]...\n       redis-stats.ts delta BEFORE.json AFTER.json [--requests=N]");
	}
}

if (import.meta.main) {
	await main();
}
