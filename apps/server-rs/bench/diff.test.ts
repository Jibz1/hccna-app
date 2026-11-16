// Run with: bun test apps/server-rs/bench
import { describe, expect, test } from "bun:test";

import { diffJson, judge } from "./diff.ts";

describe("diffJson", () => {
	test("ignores object key order but not array order", () => {
		expect(diffJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toEqual([]);
		expect(diffJson({ b: [1, 2] }, { b: [2, 1] }).map((d) => d.path)).toEqual(["b[0]", "b[1]"]);
	});

	test("reports the path and kind of each difference", () => {
		const found = diffJson(
			{ data: { a: "x", b: 1, c: [1], d: null } },
			{ data: { a: "y", e: 2, c: [1, 2], d: {} } },
		);
		expect(found.map((d) => `${d.kind} ${d.path}`).sort()).toEqual([
			"changed data.a",
			"length data.c",
			"only-in-rs data.e",
			"only-in-ts data.b",
			"type data.d",
		]);
	});

	test("ignores the fallback verse id only when both sides use it", () => {
		const verse = (verseId: string) => ({ data: { verseOfTheDayV2: { verseId, book: "Example 1:1" } } });
		expect(diffJson(verse("firebase-vod-2030-01-01-aaaaaaaa"), verse("firebase-vod-2030-01-01-bbbbbbbb"))).toEqual([]);
		expect(diffJson(verse("firebase-vod-2030-01-01-aaaaaaaa"), verse("real-id")).map((d) => d.path)).toEqual([
			"data.verseOfTheDayV2.verseId",
		]);
		expect(diffJson(verse("a"), verse("b"))).toHaveLength(1);
	});
});

const reply = (status: number, body: unknown) => ({
	status,
	ms: 1,
	text: JSON.stringify(body),
	json: body,
});

describe("judge", () => {
	const ok = { data: { campusesV2: { __typename: "CampusesSuccess", campuses: [] } } };

	test("passes equal successful responses", () => {
		const verdict = judge(reply(200, ok), reply(200, ok));
		expect(verdict.failed).toBe(false);
		expect(verdict.differences).toEqual([]);
		expect(verdict.note).toBe("");
	});

	test("fails when both servers return GraphQL errors, unless the case expects them", () => {
		const broken = { errors: [{ message: "Unexpected error." }], data: null };
		const strict = judge(reply(200, broken), reply(200, broken));
		expect(strict.failed).toBe(true);
		expect(strict.errors).toEqual({ ts: "graphql-errors", rs: "graphql-errors" });
		expect(judge(reply(200, broken), reply(200, broken), true).failed).toBe(false);
		// Expecting errors never excuses a difference between the servers.
		expect(judge(reply(200, broken), reply(200, ok), true).failed).toBe(true);
	});

	test("fails when both servers return a FetchError or NotFoundError result", () => {
		const typed = { data: { verseOfTheDayV2: { __typename: "VodNotFoundError", message: "none" } } };
		const verdict = judge(reply(200, typed), reply(200, typed));
		expect(verdict.failed).toBe(true);
		expect(verdict.errors.ts).toBe("typed-error:VodNotFoundError");
		expect(verdict.differences).toEqual([]);
	});

	test("fails on a non-200 status from both and on a status mismatch", () => {
		expect(judge(reply(503, { errors: [] }), reply(503, { errors: [] })).failed).toBe(true);
		const mismatch = judge(reply(200, ok), reply(500, { errors: [] }));
		expect(mismatch.failed).toBe(true);
		expect(mismatch.differences[0]?.path).toBe("(http status)");
	});

	test("an unreachable server fails even an edge case that expects errors", () => {
		const down = { status: 0, ms: 0, text: "request failed: TypeError", json: null };
		expect(judge(down, down, true).failed).toBe(true);
		expect(judge(down, down).failed).toBe(true);
		expect(judge(down, down, true).note).toContain("did not answer");
	});
});
