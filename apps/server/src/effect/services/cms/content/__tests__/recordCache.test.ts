import { makeMockRedis, makeRedisTestLayer } from "@/effect/services/__tests__/fixtures";
import { CmsContentError } from "@/effect/services/cms/content/CmsContent";
import { makeRecordCache, recordCacheKey } from "@/effect/services/cms/content/recordCache";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { makeMemoryRedis } from "@/graphql/__tests__/utils/memoryRedis";
import { describe, expect, it } from "bun:test";
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";

import type { RedisService } from "@/effect/RedisService";

const Value = Schema.Struct({ n: Schema.Number });
const CAMPUSES = recordCacheKey("campuses");
const CAMPUSES_KEY = "cms-v5:3:campuses:";
const CAMPUSES_GENERATION_KEY = "cms-v5:generation:campuses";
const TIMED_OUT = "Operation timed out after '500ms'";

const counting = () => {
	let calls = 0;
	const load = Effect.sync(() => {
		calls += 1;
		return { n: calls };
	});
	return { load, calls: () => calls };
};

type RecordCache = Effect.Success<typeof makeRecordCache>;

const withCache = async <A, E>(
	use: (cache: RecordCache) => Effect.Effect<A, E, RedisService>,
	redis = makeMemoryRedis(),
) => {
	const logs = captureLogs();
	const layer = Layer.merge(redis.layer, logs.layer);
	const value = await Effect.runPromise(
		makeRecordCache.pipe(Effect.flatMap(use), Effect.provide(layer)),
	);
	return { value, redis, logs: logs.lines };
};

// Lets forked fibers run until they wait on the test clock.
const settle = TestClock.withLive(Effect.sleep("10 millis"));

/** A timed read's value and virtual duration, or "still waiting" after one real second. */
const outcome = <E>(fiber: Fiber.Fiber<[Duration.Duration, { readonly n: number }], E>) =>
	Fiber.await(fiber).pipe(
		Effect.timeoutOption("1 second"),
		TestClock.withLive,
		Effect.map(
			Option.match({
				onNone: () => "still waiting",
				onSome: (exit) =>
					Exit.isSuccess(exit)
						? { millis: Duration.toMillis(exit.value[0]), value: exit.value[1] }
						: "failed",
			}),
		),
	);

/**
 * Reads CAMPUSES_KEY on a test clock against `redis`, settling and then advancing the clock
 * by each step; then reads it again without advancing the clock.
 */
const readOnTestClock = async (
	redis: Layer.Layer<RedisService>,
	steps: readonly Duration.Input[],
) => {
	const source = counting();
	const logs = captureLogs();
	const program = Effect.gen(function* () {
		const cache = yield* makeRecordCache;
		const read = Effect.timed(cache.cached(CAMPUSES, Value, source.load));
		const cold = yield* Effect.forkChild(read);
		for (const step of steps) {
			yield* settle;
			yield* TestClock.adjust(step);
		}
		const coldOutcome = yield* outcome(cold);
		const warm = yield* Effect.forkChild(read);
		return { cold: coldOutcome, warm: yield* outcome(warm) };
	});
	const layer = Layer.mergeAll(redis, logs.layer, TestClock.layer());
	const reads = await Effect.runPromise(program.pipe(Effect.provide(layer)));
	return { ...reads, loads: source.calls(), logs: logs.lines };
};

describe("recordCache", () => {
	it("builds versioned keys", () => {
		expect(CAMPUSES).toEqual({ area: "campuses", key: CAMPUSES_KEY });
		expect(recordCacheKey("events", ["house-of-stars", undefined, "x", 2])).toEqual({
			area: "events",
			key: "cms-v5:3:events:house-of-stars||x|2",
		});
	});

	it("loads once, then serves memory", async () => {
		const source = counting();
		const { value, redis } = await withCache((cache) =>
			Effect.all([
				cache.cached(CAMPUSES, Value, source.load),
				cache.cached(CAMPUSES, Value, source.load),
			]),
		);
		expect(value).toEqual([{ n: 1 }, { n: 1 }]);
		expect(source.calls()).toBe(1);
		expect(redis.store.get(CAMPUSES_KEY)).toBe('{"n":1}');
	});

	it("serves an entry another instance wrote to Redis", async () => {
		const source = counting();
		const redis = makeMemoryRedis();
		redis.store.set(CAMPUSES_KEY, '{"n":42}');
		const { value } = await withCache(
			(cache) =>
				Effect.gen(function* () {
					const first = yield* cache.cached(CAMPUSES, Value, source.load);
					// Memory now holds it: a vanished Redis entry no longer matters.
					redis.store.clear();
					return [first, yield* cache.cached(CAMPUSES, Value, source.load)];
				}),
			redis,
		);
		expect(value).toEqual([{ n: 42 }, { n: 42 }]);
		expect(source.calls()).toBe(0);
	});

	it("clears only the requested area", async () => {
		const source = counting();
		const { value } = await withCache((cache) =>
			Effect.gen(function* () {
				yield* cache.cached(CAMPUSES, Value, source.load);
				yield* cache.cached(recordCacheKey("events", ["a"]), Value, source.load);
				yield* cache.clear("campuses");
				return [
					yield* cache.cached(CAMPUSES, Value, source.load),
					yield* cache.cached(recordCacheKey("events", ["a"]), Value, source.load),
				];
			}),
		);
		expect(value).toEqual([{ n: 3 }, { n: 2 }]);
	});

	it("treats an unreadable cached value as a miss", async () => {
		const source = counting();
		const { value } = await withCache((cache) =>
			Effect.gen(function* () {
				yield* cache.cached(
					CAMPUSES,
					Schema.Struct({ other: Schema.String }),
					Effect.succeed({ other: "x" }),
				);
				return yield* cache.cached(CAMPUSES, Value, source.load);
			}),
		);
		expect(value).toEqual({ n: 1 });
	});

	it("does not cache a failed load", async () => {
		const source = counting();
		const failure = new CmsContentError({
			reason: "Unavailable",
			operation: "campuses",
			detail: "Strapi is down",
		});
		const { value, redis } = await withCache((cache) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(cache.cached(CAMPUSES, Value, Effect.fail(failure)));
				return { error, next: yield* cache.cached(CAMPUSES, Value, source.load) };
			}),
		);
		expect(value).toEqual({ error: failure, next: { n: 1 } });
		expect(redis.store.get(CAMPUSES_KEY)).toBe('{"n":1}');
	});

	// Review Focus: Redis down on Railway must still serve CMS data.
	it("serves from the source when Redis fails, then from memory, logging each failure", async () => {
		const source = counting();
		const { value, logs } = await withCache(
			(cache) =>
				Effect.all([
					cache.cached(CAMPUSES, Value, source.load),
					cache.cached(CAMPUSES, Value, source.load),
				]),
			makeMemoryRedis(true),
		);
		expect(value).toEqual([{ n: 1 }, { n: 1 }]);
		expect(source.calls()).toBe(1);
		expect(logs).toEqual([
			`Warn Strapi 5 cache read failed {"key":"${CAMPUSES_KEY}","error":"Redis mget failed"}`,
			`Warn Strapi 5 cache write failed {"key":"${CAMPUSES_KEY}","error":"Redis setex failed"}`,
		]);
	});

	it("clears memory when Redis fails, and reports the failed clear as Unavailable", async () => {
		const source = counting();
		const { value } = await withCache(
			(cache) =>
				Effect.gen(function* () {
					yield* cache.cached(CAMPUSES, Value, source.load);
					const error = yield* Effect.flip(cache.clear("campuses"));
					return { error, next: yield* cache.cached(CAMPUSES, Value, source.load) };
				}),
			makeMemoryRedis(true),
		);
		expect(value.error).toBeInstanceOf(CmsContentError);
		expect(value.error.reason).toBe("Unavailable");
		expect(value.error.operation).toBe("invalidate.campuses");
		expect(value.next).toEqual({ n: 2 });
	});
});

/**
 * Reads campuses with a load that waits while `during` runs, as when a CMS change notice
 * arrives mid-load. Returns that read's value, what Redis then holds for it, and a second
 * read's value with the number of loads both reads made.
 */
const readAcross = <E>(
	cache: RecordCache,
	store: ReadonlyMap<string, string>,
	during: Effect.Effect<void, E>,
) =>
	Effect.gen(function* () {
		const source = counting();
		const loading = yield* Deferred.make<void>();
		const resume = yield* Deferred.make<void>();
		const load = Deferred.done(loading, Exit.void).pipe(
			Effect.andThen(Deferred.await(resume)),
			Effect.andThen(source.load),
		);
		const read = yield* Effect.forkChild(cache.cached(CAMPUSES, Value, load));
		yield* Deferred.await(loading);
		yield* during;
		yield* Deferred.done(resume, Exit.void);
		const first = yield* Fiber.join(read);
		const inRedis = store.get(CAMPUSES_KEY) ?? null;
		const next = yield* cache.cached(CAMPUSES, Value, source.load);
		return { first, inRedis, next, loads: source.calls() };
	});

// Review Focus: a load that started before a CMS change must not be cached after its clear.
describe("recordCache with a clear during a load", () => {
	it("returns the load's data but caches it nowhere when its area is cleared", async () => {
		const redis = makeMemoryRedis();

		const { value } = await withCache(
			(cache) => readAcross(cache, redis.store, cache.clear("campuses")),
			redis,
		);

		expect(value).toEqual({ first: { n: 1 }, inRedis: null, next: { n: 2 }, loads: 2 });
		expect(redis.store.get(CAMPUSES_KEY)).toBe('{"n":2}');
	});

	it("caches the load when another area is cleared", async () => {
		const redis = makeMemoryRedis();

		const { value } = await withCache(
			(cache) => readAcross(cache, redis.store, cache.clear("events")),
			redis,
		);

		expect(value).toEqual({ first: { n: 1 }, inRedis: '{"n":1}', next: { n: 1 }, loads: 1 });
	});

	it("caches it nowhere when another instance clears its area", async () => {
		const redis = makeMemoryRedis();

		const { value } = await withCache(
			(cache) =>
				Effect.gen(function* () {
					const otherInstance = yield* makeRecordCache;
					return yield* readAcross(cache, redis.store, otherInstance.clear("campuses"));
				}),
			redis,
		);

		expect(value).toEqual({ first: { n: 1 }, inRedis: null, next: { n: 2 }, loads: 2 });
		expect(redis.store.get(CAMPUSES_GENERATION_KEY)).toBe("1");
	});

	it("still serves reads and skips the write on this instance's clear when Redis fails", async () => {
		const redis = makeMemoryRedis(true);

		const { value, logs } = await withCache(
			(cache) => readAcross(cache, redis.store, Effect.ignore(cache.clear("campuses"))),
			redis,
		);

		expect(value).toEqual({ first: { n: 1 }, inRedis: null, next: { n: 2 }, loads: 2 });
		// No write failure between the bump and the second read: the first read never wrote.
		const readFailed = `Warn Strapi 5 cache read failed {"key":"${CAMPUSES_KEY}","error":"Redis mget failed"}`;
		expect(logs).toEqual([
			readFailed,
			`Warn Strapi 5 cache generation bump failed {"key":"${CAMPUSES_GENERATION_KEY}","error":"Redis incr failed"}`,
			readFailed,
			`Warn Strapi 5 cache write failed {"key":"${CAMPUSES_KEY}","error":"Redis setex failed"}`,
		]);
	});
});

// Review Focus: a Redis that stops answering (rather than failing) must not stall CMS reads.
describe("recordCache with a stalled Redis", () => {
	const readTimedOut = `Warn Strapi 5 cache read failed {"key":"${CAMPUSES_KEY}","error":"${TIMED_OUT}"}`;
	const writeTimedOut = `Warn Strapi 5 cache write failed {"key":"${CAMPUSES_KEY}","error":"${TIMED_OUT}"}`;

	it("stops waiting for a Redis read after 500 ms and loads from the source", async () => {
		const stalledReads = makeRedisTestLayer(makeMockRedis({ mget: () => Effect.never }));

		const result = await readOnTestClock(stalledReads, ["500 millis"]);

		expect(result).toEqual({
			cold: { millis: 500, value: { n: 1 } },
			warm: { millis: 0, value: { n: 1 } },
			loads: 1,
			logs: [readTimedOut],
		});
	});

	it("stops waiting for a Redis write after 500 ms and still returns the data", async () => {
		const stalledWrites = makeRedisTestLayer(makeMockRedis({ setex: () => Effect.never }));

		const result = await readOnTestClock(stalledWrites, ["500 millis"]);

		expect(result).toEqual({
			cold: { millis: 500, value: { n: 1 } },
			warm: { millis: 0, value: { n: 1 } },
			loads: 1,
			logs: [writeTimedOut],
		});
	});

	it("bounds a cold read at 1 s when Redis stops answering entirely, and serves memory after", async () => {
		const stalled = makeRedisTestLayer(
			makeMockRedis({
				mget: () => Effect.never,
				get: () => Effect.never,
				setex: () => Effect.never,
			}),
		);

		const result = await readOnTestClock(stalled, ["500 millis", "500 millis"]);

		expect(result).toEqual({
			cold: { millis: 1000, value: { n: 1 } },
			warm: { millis: 0, value: { n: 1 } },
			loads: 1,
			logs: [readTimedOut, writeTimedOut],
		});
	});
});
