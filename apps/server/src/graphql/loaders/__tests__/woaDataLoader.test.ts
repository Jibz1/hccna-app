import { redis } from "@/redis";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { hashEmail } from "@/utils/hash";
import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";

import { createWOADataLoader, createWOADataLoaderKey } from "../woaDataLoader";

describe("WOADataLoader", () => {
	it("uses a user id as the cache identity when available", () => {
		const key = createWOADataLoaderKey({
			email: "test@example.com",
			userId: "firebase:user/123",
		});

		expect(key).toEqual({
			email: "test@example.com",
			cacheKey: "user:firebase%3Auser%2F123",
		});
		expect(key.cacheKey).not.toContain("test@example.com");
	});

	it("falls back to a normalized email hash instead of a raw email identity", () => {
		const key = createWOADataLoaderKey({
			email: " Test@Example.com ",
		});

		expect(key).toEqual({
			email: " Test@Example.com ",
			cacheKey: `email-sha256:${hashEmail(" Test@Example.com ")}`,
		});
		expect(key.cacheKey).not.toContain("Test@Example.com");
		expect(key.cacheKey).not.toContain("test@example.com");
	});

	describe("when the WOA source fails", () => {
		const mget = spyOn(redis, "mget");
		const logError = spyOn(getLogger(), "error");
		afterEach(() => {
			mget.mockReset();
			logError.mockReset();
		});
		afterAll(() => {
			mget.mockRestore();
			logError.mockRestore();
		});

		it("keeps the member's email out of the error and its log", async () => {
			mget.mockResolvedValue([null] as never);
			logError.mockImplementation(() => {});
			const loader = createWOADataLoader((() =>
				Promise.reject(new Error("WOA API unavailable"))) as never);

			const loading = loader.load(
				createWOADataLoaderKey({ email: "ada@example.com", userId: "user-1" }),
			);

			await expect(loading).rejects.toThrow("WOA fetch failed");
			await expect(loading).rejects.not.toThrow("ada@example.com");
			expect(logError).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(logError.mock.calls[0])).not.toContain("ada@example.com");
		});
	});
});
