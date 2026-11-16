import {
	LRU_CACHE_KEY,
	LRU_TTL_MS,
	REDIS_CACHE_KEY,
	REDIS_TTL_SECONDS,
} from "@/effect/services/vod/constants";
import { isValidCacheEntry } from "@/effect/services/vod/transforms";
import { type CachedVodEntry } from "@/effect/services/vod/types";
import { DateTime, Effect, Option } from "effect";

import type { ScriptureData } from "@/graphql/schema/scriptures/scripture";

interface VodLruClient {
	get: <T>(key: string) => Effect.Effect<T | null | undefined, unknown, never>;
	set: (
		key: string,
		value: CachedVodEntry,
		ttlMs?: number,
	) => Effect.Effect<unknown, unknown, never>;
	delete: (key: string) => Effect.Effect<unknown, unknown, never>;
}

interface VodRedisClient {
	get: (key: string) => Effect.Effect<string | null, unknown, never>;
	setex: (
		key: string,
		ttlSeconds: number,
		payload: string,
	) => Effect.Effect<unknown, unknown, never>;
	del: (key: string) => Effect.Effect<unknown, unknown, never>;
}

const toEntry = Effect.fn("VodService.cache.toEntry")(function* (
	data: ScriptureData,
	today: string,
) {
	const cachedAt = DateTime.toEpochMillis(yield* DateTime.now);
	return { data, cachedAt, date: today } satisfies CachedVodEntry;
});

// Wrap a fresh, well-formed entry in `Option.some`, otherwise `Option.none`.
const matchFreshEntry = (
	entry: CachedVodEntry | null | undefined,
	today: string,
): Option.Option<CachedVodEntry> =>
	// oxlint-disable-next-line no-array-callback-reference -- Option.some, not Array.some.
	entry && isValidCacheEntry(entry, today) ? Option.some(entry) : Option.none<CachedVodEntry>();

/**
 * Two-tier (LRU + Redis) cache facade for the verse of the day. Cache failures
 * are intentionally swallowed so reads degrade to the Firebase source.
 */
export const createVodCache = (deps: { lru: VodLruClient; redis: VodRedisClient }) => {
	const getFromLru = Effect.fn("VodService.cache.getFromLru")(function* (today: string) {
		return yield* deps.lru.get<CachedVodEntry>(LRU_CACHE_KEY).pipe(
			Effect.map((entry) => matchFreshEntry(entry, today)),
			Effect.catch(() => Effect.succeed(Option.none<CachedVodEntry>())),
		);
	});

	const setToLru = Effect.fn("VodService.cache.setToLru")(function* (
		data: ScriptureData,
		today: string,
	) {
		yield* toEntry(data, today).pipe(
			Effect.flatMap((entry) => deps.lru.set(LRU_CACHE_KEY, entry, LRU_TTL_MS)),
			Effect.catch(() => Effect.void),
			Effect.asVoid,
		);
	});

	const getFromRedis = Effect.fn("VodService.cache.getFromRedis")(function* (today: string) {
		return yield* deps.redis.get(REDIS_CACHE_KEY).pipe(
			Effect.map((value) => {
				if (!value) {
					return Option.none<CachedVodEntry>();
				}
				try {
					const entry = JSON.parse(value) as CachedVodEntry;
					return matchFreshEntry(entry, today);
				} catch {
					return Option.none<CachedVodEntry>();
				}
			}),
			Effect.catch(() => Effect.succeed(Option.none<CachedVodEntry>())),
		);
	});

	const setToRedis = Effect.fn("VodService.cache.setToRedis")(function* (
		data: ScriptureData,
		today: string,
	) {
		yield* toEntry(data, today).pipe(
			Effect.flatMap((entry) =>
				deps.redis.setex(REDIS_CACHE_KEY, REDIS_TTL_SECONDS, JSON.stringify(entry)),
			),
			Effect.catch(() => Effect.void),
			Effect.asVoid,
		);
	});

	// Writes are fanned out so LRU and Redis stay aligned for the next lookup.
	const setBothCaches = Effect.fn("VodService.cache.setBothCaches")(function* (
		data: ScriptureData,
		today: string,
	) {
		yield* Effect.all([setToLru(data, today), setToRedis(data, today)]).pipe(Effect.asVoid);
	});

	const invalidate = Effect.fn("VodService.cache.invalidate")(function* () {
		yield* Effect.all([
			deps.lru.delete(LRU_CACHE_KEY).pipe(Effect.catch(() => Effect.void)),
			deps.redis.del(REDIS_CACHE_KEY).pipe(Effect.catch(() => Effect.void)),
		]).pipe(Effect.asVoid);
	});

	return {
		getFromLru,
		getFromRedis,
		invalidate,
		setBothCaches,
		setToLru,
	};
};
