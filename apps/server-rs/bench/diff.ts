#!/usr/bin/env bun
/**
 * Correctness diff: replays the phase 1 operations once against the TS bench server and the Rust
 * server with the same Firebase token, then deep-compares the JSON responses.
 *
 *   read -rs FIREBASE_WEB_API_KEY && export FIREBASE_WEB_API_KEY   # a prompt: keeps the key out of history
 *   TS_URL=https://<ts-bench domain> RS_URL=https://<rs domain> \
 *     bun apps/server-rs/bench/diff.ts [--thorough] [--ops=NameA,NameB] [--out=DIR]
 *
 * TS_URL and RS_URL are checked against a denylist (k6/guard.js): the live hccna-backend and
 * production domains are refused.
 *
 * Run it after flushing the bench Redis and restarting both servers, so cache ages match, and at a
 * low rate (it sends a handful of requests). TS is the reference: variables (campus and event
 * slugs, sermon cursors) are discovered from its responses.
 *
 * Default: one case per operation (11). --thorough adds variants: other campuses and events, an
 * unknown slug, and the sermon paging edges (first 0, first over 100, an invalid cursor, a cursor
 * from the middle of the list).
 *
 * A case fails when the responses differ, and also when a server answers with a non-200 status, a
 * GraphQL `errors` array or a FetchError / NotFoundError result, even if both servers do the same:
 * two equally broken servers prove nothing. Only the deliberate edge cases (--thorough: first 0,
 * over 100, an invalid cursor, an unknown event slug) may error, and must then match. A case that
 * cannot be built (for example no upcoming events, so no EventDetailQuery) is printed as SKIP and
 * listed in the report; it is never dropped silently.
 *
 * Known nondeterminism ignored: `verseOfTheDayV2.verseId` when both sides return the
 * `firebase-vod-<date>-<uuid>` fallback (the Firestore document had no id; each server makes its
 * own uuid).
 *
 * Responses are real CMS content. Bodies, values and the full report are written under
 * $TMPDIR (or --out), never into the checkout: this script refuses an --out inside the repository.
 * stdout carries only case labels (never slugs), verdicts and the JSON paths that differ, never values.
 * Exit status: 0 all equal, 1 any difference or request failure, 2 usage error. Skipped cases do
 * not change the status but end the run with a WARNING line.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import operationsFile from "./operations.json";
import { classifyResponse } from "./k6/classify.js";
import { campusSlugs, sermonPage, upcomingEventSlugs } from "./k6/discovery.js";
import { assertAllowedUrl } from "./k6/guard.js";

interface Operation {
	readonly name: string;
	readonly text: string;
}
interface Case {
	readonly id: string;
	readonly operation: string;
	readonly variables: Record<string, unknown>;
	/** Deliberate edge cases may answer with errors; both servers must then agree. */
	readonly expectErrors?: boolean;
}
interface Skipped {
	readonly operation: string;
	readonly reason: string;
}
interface Reply {
	readonly status: number;
	readonly ms: number;
	readonly text: string;
	readonly json: unknown;
}
export interface Difference {
	readonly path: string;
	readonly kind: "changed" | "only-in-ts" | "only-in-rs" | "type" | "length";
	readonly ts?: string;
	readonly rs?: string;
}

const FALLBACK_VERSE_ID = "firebase-vod-";
const VERSE_ID_PATH = "data.verseOfTheDayV2.verseId";
const operations = new Map<string, Operation>(
	(operationsFile.operations as Operation[]).map((op) => [op.name, op]),
);
const repoRoot = resolve(import.meta.dir, "../../..");

function usage(message: string): never {
	console.error(message);
	console.error(
		"usage: TS_URL=... RS_URL=... bun apps/server-rs/bench/diff.ts [--thorough] [--ops=A,B] [--out=DIR]   (FIREBASE_WEB_API_KEY comes from a prompt, see RUNBOOK.md)",
	);
	process.exit(2);
}

function describe(value: unknown): string {
	const text = JSON.stringify(value) ?? "undefined";
	return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

/** Deep-compares two parsed JSON values; object key order does not matter, array order does. */
export function diffJson(ts: unknown, rs: unknown, path = ""): Difference[] {
	if (path === VERSE_ID_PATH && isFallbackVerseId(ts) && isFallbackVerseId(rs)) {
		return [];
	}
	if (Array.isArray(ts) || Array.isArray(rs)) {
		if (!Array.isArray(ts) || !Array.isArray(rs)) {
			return [{ path, kind: "type", ts: describe(ts), rs: describe(rs) }];
		}
		const found: Difference[] = [];
		if (ts.length !== rs.length) {
			found.push({ path, kind: "length", ts: String(ts.length), rs: String(rs.length) });
		}
		for (let i = 0; i < Math.min(ts.length, rs.length); i += 1) {
			found.push(...diffJson(ts[i], rs[i], `${path}[${i}]`));
		}
		return found;
	}
	if (isObject(ts) || isObject(rs)) {
		if (!isObject(ts) || !isObject(rs)) {
			return [{ path, kind: "type", ts: describe(ts), rs: describe(rs) }];
		}
		const found: Difference[] = [];
		for (const key of new Set([...Object.keys(ts), ...Object.keys(rs)])) {
			const child = path === "" ? key : `${path}.${key}`;
			if (!(key in rs)) {
				found.push({ path: child, kind: "only-in-ts", ts: describe(ts[key]) });
			} else if (!(key in ts)) {
				found.push({ path: child, kind: "only-in-rs", rs: describe(rs[key]) });
			} else {
				found.push(...diffJson(ts[key], rs[key], child));
			}
		}
		return found;
	}
	return Object.is(ts, rs)
		? []
		: [{ path, kind: "changed", ts: describe(ts), rs: describe(rs) }];
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFallbackVerseId(value: unknown): boolean {
	return typeof value === "string" && value.startsWith(FALLBACK_VERSE_ID);
}

async function signUp(): Promise<string> {
	const key = process.env.FIREBASE_WEB_API_KEY;
	if (!key) usage("FIREBASE_WEB_API_KEY is not set");
	const base = (process.env.IDENTITY_TOOLKIT_URL ?? "https://identitytoolkit.googleapis.com").replace(
		/\/+$/u,
		"",
	);
	// The key goes in a header, not the URL, and any failure is reduced to a status or error name,
	// so nothing printed here can contain it.
	try {
		const res = await fetch(`${base}/v1/accounts:signUp`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-goog-api-key": key },
			body: JSON.stringify({ returnSecureToken: true }),
			signal: AbortSignal.timeout(15_000),
		});
		const body = (await res.json().catch(() => null)) as { idToken?: string } | null;
		if (!res.ok || !body?.idToken) {
			throw new Error(`HTTP ${res.status}`);
		}
		return body.idToken;
	} catch (error) {
		const detail = error instanceof Error && error.message.startsWith("HTTP ") ? error.message : errorName(error);
		throw new Error(`anonymous sign-up failed: ${detail}`);
	}
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "unknown error";
}

async function send(
	baseUrl: string,
	token: string,
	operation: string,
	variables: Record<string, unknown>,
): Promise<Reply> {
	const op = operations.get(operation);
	if (!op) throw new Error(`unknown operation ${operation}`);
	const started = performance.now();
	const res = await fetch(`${baseUrl}/graphql`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"accept-encoding": "gzip",
			authorization: `Bearer ${token}`,
			"x-hccna-app-version": "bench",
			"x-hccna-device-type": "bench",
			"x-hccna-os-name": "bench",
			"user-agent": "hccna-bench-diff",
		},
		body: JSON.stringify({ query: op.text, variables }),
		signal: AbortSignal.timeout(30_000),
	});
	const text = await res.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		// Kept as text; the status and body are reported.
	}
	return { status: res.status, ms: Math.round(performance.now() - started), text, json };
}

/** Variables for each case, discovered from the reference (TS) server. */
export async function buildCases(
	ask: (operation: string, variables: Record<string, unknown>) => Promise<Reply>,
	thorough: boolean,
): Promise<{ cases: Case[]; skipped: Skipped[] }> {
	const campuses = campusSlugs((await ask("CampusesQuery", { preferredCampus: null })).json);
	if (campuses.length === 0) {
		throw new Error("the TS server returned no campuses; nothing to compare against");
	}
	const pairs: { slug: string; campusSlug: string }[] = [];
	for (const campusSlug of campuses.slice(0, thorough ? 5 : 1)) {
		const slugs = upcomingEventSlugs((await ask("LatestEventsQuery", { campusSlug })).json);
		for (const slug of slugs.slice(0, thorough ? 3 : 1)) pairs.push({ slug, campusSlug });
	}
	const cursors: string[] = [];
	if (thorough) {
		const page = sermonPage((await ask("SermonsItemsRefetchQuery", { count: 50, cursor: null })).json);
		cursors.push(...page.cursors);
	}

	const cases: Case[] = [];
	const skipped: Skipped[] = [];
	const add = (
		operation: string,
		variables: Record<string, unknown>,
		label = "",
		expectErrors = false,
	) =>
		cases.push({
			id: label ? `${operation}[${label}]` : operation,
			operation,
			variables,
			expectErrors,
		});
	for (const [name] of operations) {
		if (name === "CampusesQuery") {
			add(name, { preferredCampus: campuses[0] }, thorough ? "first" : "");
		} else if (name === "LatestEventsQuery") {
			add(name, { campusSlug: pairs[0]?.campusSlug ?? campuses[0] }, thorough ? "campus 1" : "");
		} else if (name === "EventDetailQuery") {
			if (pairs[0]) {
				add(name, { ...pairs[0] }, thorough ? "event 1" : "");
			} else {
				skipped.push({ operation: name, reason: "the TS server lists no upcoming events to open" });
			}
		} else if (name === "SermonsItemsRefetchQuery") {
			add(name, { count: 10, cursor: null }, thorough ? "count 10" : "");
		} else {
			add(name, {});
		}
	}
	if (thorough) {
		add("CampusesQuery", { preferredCampus: null }, "no preference");
		add("CampusesQuery", { preferredCampus: "bench-unknown-campus" }, "unknown slug");
		campuses.slice(1, 5).forEach((campusSlug, i) => {
			add("LatestEventsQuery", { campusSlug }, `campus ${i + 2}`);
		});
		pairs.slice(1).forEach((pair, i) => add("EventDetailQuery", { ...pair }, `event ${i + 2}`));
		if (pairs[0]) {
			add("EventDetailQuery", { slug: "bench-unknown-event", campusSlug: pairs[0].campusSlug }, "unknown slug", true);
		}
		add("SermonsItemsRefetchQuery", { count: 1, cursor: null }, "count 1");
		add("SermonsItemsRefetchQuery", { count: 50, cursor: null }, "count 50");
		// The paging edges the TS resolver treats specially; erroring is allowed if both agree.
		add("SermonsItemsRefetchQuery", { count: 0, cursor: null }, "count 0", true);
		add("SermonsItemsRefetchQuery", { count: 100, cursor: null }, "count 100");
		add("SermonsItemsRefetchQuery", { count: 101, cursor: null }, "count 101", true);
		add("SermonsItemsRefetchQuery", { count: 10, cursor: "not-a-cursor" }, "invalid cursor", true);
		if (cursors.length > 0) {
			add("SermonsItemsRefetchQuery", { count: 10, cursor: cursors[0] }, "after first");
			add("SermonsItemsRefetchQuery", { count: 10, cursor: cursors[Math.floor(cursors.length / 2)] }, "after middle");
			add("SermonsItemsRefetchQuery", { count: 10, cursor: cursors.at(-1) }, "after last");
		}
	}
	return { cases, skipped };
}

export interface Verdict {
	readonly differences: Difference[];
	readonly failed: boolean;
	/** Why a server's answer counts as an error (`http-500`, `graphql-errors`, `typed-error:X`). */
	readonly errors: { readonly ts: string | null; readonly rs: string | null };
	readonly note: string;
}

/**
 * Decides one case. It fails when the responses differ, and when either server answers with an
 * error (non-200, GraphQL `errors`, FetchError/NotFoundError result) unless the case is a
 * deliberate edge case (`expectErrors`), where errors are fine as long as both servers agree.
 */
export function judge(ts: Reply, rs: Reply, expectErrors = false): Verdict {
	const differences: Difference[] = [];
	if (ts.status !== rs.status) {
		differences.push({ path: "(http status)", kind: "changed", ts: String(ts.status), rs: String(rs.status) });
	}
	if (ts.json === null || rs.json === null) {
		if (ts.text !== rs.text) {
			differences.push({
				path: "(body)",
				kind: "changed",
				ts: describe(ts.text.slice(0, 120)),
				rs: describe(rs.text.slice(0, 120)),
			});
		}
	} else {
		differences.push(...diffJson(ts.json, rs.json));
	}
	const tsClass = classifyResponse(ts.status, ts.text);
	const rsClass = classifyResponse(rs.status, rs.text);
	const errors = { ts: tsClass.reason, rs: rsClass.reason };
	const anyError = !tsClass.ok || !rsClass.ok;
	// Status 0 means the server was unreachable: never an "expected" error, even for edge cases.
	const unreachable = ts.status === 0 || rs.status === 0;
	const failed = differences.length > 0 || unreachable || (anyError && !expectErrors);

	let note = "";
	if (unreachable && differences.length === 0) {
		note = " (a server did not answer)";
	} else if (anyError && differences.length === 0) {
		note = expectErrors
			? ` (both servers returned the same error: ${tsClass.reason ?? rsClass.reason}; expected for this case)`
			: ` (both servers returned ${tsClass.reason ?? rsClass.reason}; equal, but not a valid comparison)`;
	}
	return { differences, failed, errors, note };
}

function safeName(id: string): string {
	return id.replace(/[^A-Za-z0-9._-]+/gu, "_");
}

function option(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
	const tsUrl = process.env.TS_URL?.replace(/\/+$/u, "");
	const rsUrl = process.env.RS_URL?.replace(/\/+$/u, "");
	if (!tsUrl || !rsUrl) usage("TS_URL and RS_URL must both be set");
	try {
		assertAllowedUrl(tsUrl, "TS_URL");
		assertAllowedUrl(rsUrl, "RS_URL");
	} catch (error) {
		usage(error instanceof Error ? error.message : "refused target");
	}

	const outDir = resolve(
		option("out") ??
			join(process.env.TMPDIR ?? tmpdir(), `server-rs-diff-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`),
	);
	if (outDir === repoRoot || outDir.startsWith(`${repoRoot}${sep}`)) {
		usage(`refusing to write responses inside the repository (${outDir}); use a path under $TMPDIR`);
	}
	// Responses are production-derived content: owner-only directory and files.
	mkdirSync(outDir, { recursive: true, mode: 0o700 });
	chmodSync(outDir, 0o700);

	const only = option("ops")?.split(",").map((name) => name.trim());
	let token: string;
	try {
		token = await signUp();
	} catch (error) {
		// Never print the raw error: only the message built in signUp().
		console.error(error instanceof Error ? error.message : "anonymous sign-up failed");
		process.exit(1);
	}
	const built = await buildCases((op, variables) => send(tsUrl, token, op, variables), process.argv.includes("--thorough"));
	const cases = built.cases.filter((c) => only === undefined || only.includes(c.operation));
	const skipped = built.skipped.filter((c) => only === undefined || only.includes(c.operation));
	if (cases.length === 0) {
		usage(`no case to run${only ? ` for --ops=${only.join(",")}` : ""}`);
	}

	let failures = 0;
	const report: unknown[] = [];
	for (const testCase of cases) {
		const [ts, rs] = await Promise.all([
			send(tsUrl, token, testCase.operation, testCase.variables).catch(errorReply),
			send(rsUrl, token, testCase.operation, testCase.variables).catch(errorReply),
		]);
		const verdict = judge(ts, rs, testCase.expectErrors);
		if (verdict.failed) failures += 1;

		const base = join(outDir, safeName(testCase.id));
		writeFileSync(`${base}.ts.json`, ts.text, { mode: 0o600 });
		writeFileSync(`${base}.rs.json`, rs.text, { mode: 0o600 });
		report.push({
			case: testCase.id,
			variables: testCase.variables,
			expectErrors: testCase.expectErrors === true,
			status: { ts: ts.status, rs: rs.status },
			ms: { ts: ts.ms, rs: rs.ms },
			equal: verdict.differences.length === 0,
			errors: verdict.errors,
			failed: verdict.failed,
			differences: verdict.differences,
		});

		const count = verdict.differences.length;
		console.log(
			`${verdict.failed ? "FAIL" : "PASS"} ${testCase.id}${count ? `  ${count} difference(s)` : ""}${verdict.note}`,
		);
		for (const difference of verdict.differences.slice(0, 10)) {
			console.log(`     ${difference.kind.padEnd(10)} ${difference.path}`);
		}
		if (count > 10) console.log(`     ... ${count - 10} more in the report`);
	}
	for (const skip of skipped) {
		console.log(`SKIP ${skip.operation}  (${skip.reason})`);
	}

	writeFileSync(
		join(outDir, "report.json"),
		`${JSON.stringify({ tsUrl, rsUrl, cases: report, skipped }, null, 2)}\n`,
		{ mode: 0o600 },
	);
	console.log(`\n${cases.length - failures}/${cases.length} cases passed. Report and bodies: ${outDir}`);
	if (skipped.length > 0) {
		console.log(`WARNING: ${skipped.length} case(s) skipped, so ${skipped.map((c) => c.operation).join(", ")} was not compared.`);
	}
	process.exit(failures === 0 ? 0 : 1);
}

function errorReply(error: unknown): Reply {
	return { status: 0, ms: 0, text: `request failed: ${errorName(error)}`, json: null };
}

if (import.meta.main) {
	await main();
}
