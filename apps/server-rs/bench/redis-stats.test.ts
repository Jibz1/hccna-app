// Run with: bun test apps/server-rs/bench
import { describe, expect, test } from "bun:test";

import { DEFAULT_PATTERNS, deltaOf, parseCommandStats, type Snapshot } from "./redis-stats.ts";

const INFO = [
	"# Commandstats",
	"cmdstat_incr:calls=120,usec=240,usec_per_call=2.00,rejected_calls=0,failed_calls=0",
	"cmdstat_setex:calls=7,usec=70,usec_per_call=10.00,rejected_calls=0,failed_calls=0",
	"cmdstat_client|setinfo:calls=2,usec=4,usec_per_call=2.00,rejected_calls=0,failed_calls=0",
	"",
].join("\r\n");

const snapshot = (atMs: number, commands: Snapshot["commands"], dbsize: number, rs: number): Snapshot => ({
	type: "redis",
	label: "x",
	at: new Date(atMs).toISOString(),
	atMs,
	dbsize,
	commands,
	keys: { "rs:*": rs },
});

describe("redis stats", () => {
	test("parses INFO commandstats, including sub-commands", () => {
		const stats = parseCommandStats(INFO);
		expect(stats.incr).toEqual({ calls: 120, usec: 240 });
		expect(stats.setex?.calls).toBe(7);
		expect(stats["client|setinfo"]?.calls).toBe(2);
	});

	test("computes per-run deltas and per-request ratios, leaving out our own traffic", () => {
		const before = snapshot(1000, { incr: { calls: 100, usec: 0 }, info: { calls: 1, usec: 0 } }, 4, 1);
		const after = snapshot(31_000, { incr: { calls: 400, usec: 0 }, setex: { calls: 270, usec: 0 }, info: { calls: 2, usec: 0 }, hset: { calls: 3, usec: 0 } }, 280, 271);
		const delta = deltaOf(before, after, 300);
		expect(delta.seconds).toBe(30);
		expect(delta.commands.incr).toBe(300);
		expect(delta.commands.setex).toBe(270);
		expect(delta.commands.hset).toBe(3);
		expect("info" in delta.commands).toBe(false);
		expect(delta.perRequest?.incr).toBe(1);
		expect(delta.perRequest?.setex).toBe(0.9);
		expect(delta.dbsize).toEqual({ before: 4, after: 280, delta: 276 });
		expect(delta.keys["rs:*"]).toBe(270);
		expect(delta.counterReset).toBe(false);
	});

	test("flags a restart as a counter reset", () => {
		const before = snapshot(0, { incr: { calls: 100, usec: 0 } }, 1, 0);
		const after = snapshot(1000, { incr: { calls: 3, usec: 0 } }, 1, 0);
		expect(deltaOf(before, after).counterReset).toBe(true);
	});

	test("counts each server's response-cache entries separately from its other keys", () => {
		// `rs:*` also matches the Rust record cache, core/VOD/CCB entries and rate-limit keys, so
		// the Rust response entries need their own pattern, alongside the unprefixed TS one.
		expect(DEFAULT_PATTERNS).toContain("rs:graphql:response-cache:result:v2:*");
		expect(DEFAULT_PATTERNS).toContain("graphql:response-cache:result:v2:*");
		expect(DEFAULT_PATTERNS).toContain("rs:cms-v5:*");
		expect(DEFAULT_PATTERNS).toContain("rs:*");
		expect(new Set(DEFAULT_PATTERNS).size).toBe(DEFAULT_PATTERNS.length);
	});
});
