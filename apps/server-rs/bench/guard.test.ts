// Run with: bun test apps/server-rs/bench
import { describe, expect, test } from "bun:test";

import { classifyResponse, typedErrorIn } from "./k6/classify.js";
import { assertAllowedUrl, deniedReason, hostOf } from "./k6/guard.js";

describe("host denylist", () => {
	test("refuses the live service, production domains and production Redis", () => {
		for (const url of [
			"http://hccna-backend.railway.internal:8080",
			"http://HCCNA-BACKEND.railway.internal.:8080/graphql",
			"https://hccna-backend-production.up.railway.app/readyz",
			"https://api.hccnj.org/graphql",
			"https://hccnj.org",
			"https://user:pw@www.hccnj.org/x",
			"redis://default:pw@hccna-redis.railway.internal:6379",
			"redis://hccna-redis-production.up.railway.app:1234",
		]) {
			expect(deniedReason(url)).not.toBeNull();
			expect(() => assertAllowedUrl(url, "TARGET_URL")).toThrow(/TARGET_URL is refused/);
		}
	});

	test("allows the bench services and local stubs", () => {
		for (const url of [
			"http://hccna-backend-rs.railway.internal:8080",
			"http://hccna-backend-ts-bench.railway.internal:9184",
			"https://hccna-backend-rs-production.up.railway.app",
			"https://hccna-backend-ts-bench-production.up.railway.app",
			"redis://default:pw@hccna-bench-redis.railway.internal:6379",
			"http://127.0.0.1:18080",
			"http://[::1]:8080",
			"https://not-hccnj.org.example.com",
		]) {
			expect(deniedReason(url)).toBeNull();
		}
	});

	test("rejects values that are not URLs", () => {
		expect(deniedReason("hccna-backend.railway.internal:8080")).not.toBeNull();
		expect(deniedReason("")).not.toBeNull();
		expect(hostOf("http://a.example:80/x")).toBe("a.example");
	});
});

describe("classifyResponse", () => {
	test("accepts a plain success", () => {
		expect(classifyResponse(200, '{"data":{"core":{"giving":null}}}')).toEqual({
			ok: true,
			reason: null,
		});
	});

	test("counts HTTP errors, GraphQL errors and typed error results as failures", () => {
		expect(classifyResponse(429, "{}").reason).toBe("http-429");
		expect(classifyResponse(200, '{"errors":[{"message":"x"}],"data":null}').reason).toBe(
			"graphql-errors",
		);
		for (const name of [
			"CampusesFetchError",
			"CampusesNotFoundError",
			"UpcomingEventsByMonthFetchError",
			"VodFetchError",
			"CCBFormsNotFoundError",
		]) {
			const body = `{"data":{"x":{"__typename":"${name}","message":"nope"}}}`;
			expect(classifyResponse(200, body)).toEqual({ ok: false, reason: `typed-error:${name}` });
			expect(typedErrorIn(body)).toBe(name);
		}
		// Whitespace between the key and value is still caught.
		expect(typedErrorIn('{"__typename" : "VodFetchError"}')).toBe("VodFetchError");
	});

	test("does not mistake success types for errors", () => {
		const body = '{"data":{"campusesV2":{"__typename":"CampusesSuccess","campuses":[]}}}';
		expect(classifyResponse(200, body).ok).toBe(true);
		expect(typedErrorIn('{"title":"A FetchError story"}')).toBeNull();
	});
});
