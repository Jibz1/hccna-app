import {
	getWordOfActivationByEmailEffect,
	wordOfActivationMonth,
	type WordOfActivationData,
} from "@/effect/services/WordOfActivationService";
import { redis } from "@/redis";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { hashEmail } from "@/utils/hash";
import { createRedisCache } from "@/utils/redisCache";
import { Temporal } from "@js-temporal/polyfill";
import DataLoader from "dataloader";
import { DateTime } from "effect";
import { LRUCache } from "lru-cache";

import type { EffectRunner } from "@/effect/DataLoaderFactory";

// Cache configuration
const ttl = Temporal.Duration.from({ hours: 1 });
const staleDuration = Temporal.Duration.from({ hours: 1 });

// Redis cache for WOA responses (shared across requests)
const redisCache = createRedisCache<WordOfActivationData>({
	redis,
	prefix: "woa-dataloader",
	ttl,
	staleDuration,
});

// In-memory L1 cache for hot data (bounded and safe)
const memoryCache = new LRUCache<string, WordOfActivationData>({
	max: 200, // Increased from 100 for better hit rate
	ttl: ttl.total({ unit: "milliseconds" }),
	allowStale: true,
	allowStaleOnFetchRejection: true,
	allowStaleOnFetchAbort: true,
	updateAgeOnGet: true,
});

export interface WOADataLoaderKey {
	readonly email: string;
	readonly cacheKey: string;
}

export function createWOADataLoaderKey({
	email,
	userId,
}: {
	email: string;
	userId?: string | null | undefined;
}): WOADataLoaderKey {
	const normalizedUserId = userId?.trim();

	return {
		email,
		cacheKey: normalizedUserId
			? `user:${encodeURIComponent(normalizedUserId)}`
			: `email-sha256:${hashEmail(email)}`,
	};
}

const buildWOACacheKey = ({ cacheKey }: WOADataLoaderKey) => `woa-${cacheKey}`;

/**
 * Batch function for WOA DataLoader with three-tier caching.
 * L1 and L2 checks are batched to avoid N+1 Redis calls.
 */
function batchWOARequests(runPromise: EffectRunner) {
	return async (keys: readonly WOADataLoaderKey[]): Promise<(WordOfActivationData | Error)[]> => {
		const currentMonth = wordOfActivationMonth(DateTime.toEpochMillis(DateTime.nowUnsafe()));
		const results = new Map<string, WordOfActivationData | Error>();
		const l1Misses: WOADataLoaderKey[] = [];

		// L1: Batch check in-memory cache
		for (const key of keys) {
			const cacheKey = buildWOACacheKey(key);
			const cached = memoryCache.get(cacheKey);
			if (cached?.month === currentMonth) {
				results.set(cacheKey, cached);
			} else {
				l1Misses.push(key);
			}
		}

		// L2: Batch check Redis using mget
		if (l1Misses.length > 0) {
			const redisCacheKeys = l1Misses.map((key) => buildWOACacheKey(key));
			const redisResults = await redisCache.getMultiple(redisCacheKeys);

			const l2Misses: WOADataLoaderKey[] = [];
			for (let i = 0; i < l1Misses.length; i++) {
				const key = l1Misses[i]!;
				const cacheKey = buildWOACacheKey(key);
				const redisResult = redisResults[i];
				if (redisResult?.value?.month === currentMonth) {
					memoryCache.set(cacheKey, redisResult.value);
					results.set(cacheKey, redisResult.value);
				} else {
					l2Misses.push(key);
				}
			}

			// L3: Fetch remaining from source (individual — WOA API doesn't support batch)
			await Promise.all(
				l2Misses.map(async (key) => {
					const { email } = key;
					const cacheKey = buildWOACacheKey(key);

					try {
						const woaData = await runPromise(getWordOfActivationByEmailEffect(email));

						if (woaData) {
							const result: WordOfActivationData = {
								...woaData,
								email,
							};
							await redisCache.set(cacheKey, result);
							memoryCache.set(cacheKey, result);
							results.set(cacheKey, result);
						} else {
							results.set(cacheKey, {
								book: "",
								stBook: "",
								month: "",
								name: "",
								monthlySub: false,
								email,
								text: "",
								image: undefined,
								verseId: undefined,
							});
						}
					} catch (error) {
						// The cache key, not the email, identifies the member in logs and errors.
						getLogger().error({ err: error, cacheKey }, "WOA DataLoader fetch failed");
						results.set(cacheKey, new Error("WOA fetch failed", { cause: error }));
					}
				}),
			);
		}

		// Return results in original order
		return keys.map(
			(key) => results.get(buildWOACacheKey(key)) ?? new Error(`No result for ${key.cacheKey}`),
		);
	};
}

/**
 * Creates a new WOA DataLoader instance
 */
export function createWOADataLoader(runPromise: EffectRunner) {
	return new DataLoader<WOADataLoaderKey, WordOfActivationData, string>(
		batchWOARequests(runPromise),
		{
			// Cache for the duration of a single request
			cache: true,
			cacheKeyFn: ({ cacheKey }) => cacheKey,
			// Maximum batch size
			maxBatchSize: 50,
			// Name for APM tools
			name: "WOADataLoader",
		},
	);
}
