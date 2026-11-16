import { makeMockRedis, makeRedisTestLayer } from "@/effect/services/__tests__/fixtures";
import {
	getGraphQLRateLimitStoreEffect,
	GraphQLRateLimitStoreServiceLive,
} from "@/effect/services/GraphQLRateLimitStoreService";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

const hitCounts = new Map<string, number>();
const ttlValues = new Map<string, number>();

const mockRedis = makeMockRedis({
	get: (key: string) => Effect.succeed(hitCounts.has(key) ? String(hitCounts.get(key) ?? 0) : null),
	mget: (_keys: string[]) => Effect.succeed([]),
	set: (_key: string, _value: string) => Effect.void,
	setex: (_key: string, _seconds: number, _value: string) => Effect.void,
	incr: (key: string) => {
		const next = (hitCounts.get(key) ?? 0) + 1;
		hitCounts.set(key, next);
		return Effect.succeed(next);
	},
	decr: (key: string) => {
		const next = (hitCounts.get(key) ?? 0) - 1;
		hitCounts.set(key, next);
		return Effect.succeed(next);
	},
	ttl: (key: string) => Effect.succeed(ttlValues.get(key) ?? -1),
	expire: (key: string, seconds: number) => {
		ttlValues.set(key, seconds);
		return Effect.void;
	},
	del: (key: string) => {
		hitCounts.delete(key);
		ttlValues.delete(key);
		return Effect.void;
	},
	keys: (_pattern: string) => Effect.succeed([]),
});

const failingRedis = {
	...mockRedis,
	incr: (_key: string) => Effect.fail(new Error("redis unavailable")),
	expire: (_key: string, _seconds: number) => Effect.fail(new Error("redis unavailable")),
	ttl: (_key: string) => Effect.fail(new Error("redis unavailable")),
};

const TestLayer = GraphQLRateLimitStoreServiceLive.pipe(
	Layer.provide(makeRedisTestLayer(mockRedis)),
);

const FailingRedisLayer = GraphQLRateLimitStoreServiceLive.pipe(
	Layer.provide(makeRedisTestLayer(failingRedis)),
);

describe("GraphQLRateLimitStoreService", () => {
	it("increments hits consistently across requests", async () => {
		hitCounts.clear();
		ttlValues.clear();

		const store = await Effect.runPromise(
			Effect.provide(getGraphQLRateLimitStoreEffect(60_000), TestLayer),
		);

		const first = await store.increment("203.0.113.10");
		const second = await store.increment("203.0.113.10");

		expect(first.totalHits).toBe(1);
		expect(second.totalHits).toBe(2);
		expect(second.resetTime).toBeInstanceOf(Date);
	});

	it("uses a bounded local fallback when Redis increment fails", async () => {
		const store = await Effect.runPromise(
			Effect.provide(getGraphQLRateLimitStoreEffect(60_000), FailingRedisLayer),
		);

		const first = await store.increment("203.0.113.77");
		const second = await store.increment("203.0.113.77");

		expect(first.totalHits).toBe(1);
		expect(second.totalHits).toBe(2);
		expect(second.resetTime).toBeInstanceOf(Date);
	});
});
