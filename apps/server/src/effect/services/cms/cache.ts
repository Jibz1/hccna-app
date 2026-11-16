import { LRU_TTL_MS, REDIS_TTL_SECONDS } from "@/effect/services/cms/constants";
import { DateTime, Effect } from "effect";

import type { LRUService } from "@/effect/LRUService";
import type { RedisService } from "@/effect/RedisService";
import type { CachedEntry } from "@/effect/services/cms/types";

interface CmsCacheDependencies {
	lru: typeof LRUService.Service;
	redis: typeof RedisService.Service;
}

export function createCmsCacheHelpers<T>(
	{ lru, redis }: CmsCacheDependencies,
	lruKey: string,
	redisKey: string,
) {
	return {
		getFromLRU: lru.get<CachedEntry<T>>(lruKey).pipe(
			Effect.map((entry) => entry?.data ?? null),
			Effect.catchTag("LRUError", () => Effect.succeed(null)),
			Effect.withSpan(`CMSService.getFromLRU.${lruKey}`),
		),

		setToLRU: (data: T) =>
			Effect.gen(function* () {
				const cachedAt = DateTime.toEpochMillis(yield* DateTime.now);
				yield* lru.set(lruKey, { data, cachedAt }, LRU_TTL_MS);
			}).pipe(
				Effect.catchTag("LRUError", () => Effect.void),
				Effect.withSpan(`CMSService.setToLRU.${lruKey}`),
			),

		getFromRedis: redis.get(redisKey).pipe(
			Effect.map((value) => {
				if (!value) {
					return null;
				}
				try {
					const entry = JSON.parse(value) as CachedEntry<T>;
					return entry?.data ?? null;
				} catch {
					return null;
				}
			}),
			Effect.catchTag("RedisError", () => Effect.succeed(null)),
			Effect.withSpan(`CMSService.getFromRedis.${redisKey}`),
		),

		setToRedis: (data: T) =>
			Effect.gen(function* () {
				const cachedAt = DateTime.toEpochMillis(yield* DateTime.now);
				yield* redis.setex(redisKey, REDIS_TTL_SECONDS, JSON.stringify({ data, cachedAt }));
			}).pipe(
				Effect.catchTag("RedisError", () => Effect.void),
				Effect.withSpan(`CMSService.setToRedis.${redisKey}`),
			),

		clear: Effect.all([
			lru.delete(lruKey).pipe(Effect.catchTag("LRUError", () => Effect.void)),
			redis.del(redisKey).pipe(Effect.catchTag("RedisError", () => Effect.void)),
		]).pipe(Effect.asVoid),

		clearStrict: Effect.all([lru.delete(lruKey), redis.del(redisKey)]).pipe(
			Effect.asVoid,
			Effect.withSpan(`CMSService.clearStrict.${lruKey}`),
		),
	};
}
