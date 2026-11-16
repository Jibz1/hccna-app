import { redis as defaultRedis } from "@/redis";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { Temporal } from "@js-temporal/polyfill";

import type { RedisClient } from "bun";

// The version of the underlying redis cache format:
const REDIS_CACHE_VERSION = 2;

const ZERO_DURATION = Temporal.Duration.from({ milliseconds: 0 });

interface RedisCacheOptions {
	prefix: string;
	redis?: RedisClient;
	ttl: Temporal.Duration;
	/** The amount of time to allow stale values to be returned. */
	staleDuration?: Temporal.Duration;
}

export function createRedisCache<T>({
	redis = defaultRedis,
	prefix,
	ttl,
	staleDuration = ZERO_DURATION,
}: RedisCacheOptions) {
	const getKey = (key: string) => `${prefix}:${REDIS_CACHE_VERSION}:${key}`;

	const cache = {
		async get(key: string) {
			const [res] = await cache.getMultiple([key]);
			return res;
		},

		async getMultiple(
			keys: string[],
		): Promise<{ value: T | null; stale: boolean; expiresAt: number }[]> {
			// oxlint-disable-next-line no-magic-numbers
			if (!keys || keys.length === 0) {
				return [];
			}

			try {
				const values = await redis.mget(...keys.map((key) => getKey(key)));

				// Ensure values is always an array
				const valuesArray = Array.isArray(values) ? values : [];

				return valuesArray.map((value) => {
					if (!value) {
						return {
							// oxlint-disable-next-line no-null
							value: null,
							stale: false,
							expiresAt: 0,
						};
					}

					const parsed = JSON.parse(value) as {
						value: T;
						expiresAt: number;
					};

					return {
						value: parsed.value,
						stale: Date.now() > parsed.expiresAt,
						expiresAt: parsed.expiresAt,
					};
				});
			} catch (error) {
				// Redis connection failure - return cache misses to allow fallback
				getLogger().warn(
					{ err: error, prefix, keyCount: keys.length },
					"Redis cache getMultiple failed",
				);
				return keys.map(() => ({
					// oxlint-disable-next-line no-null
					value: null,
					stale: false,
					expiresAt: 0,
				}));
			}
		},

		async set(key: string, value: T) {
			return await cache.setMultiple([[key, value]]);
		},

		async setMultiple(entries: [string, T][]) {
			try {
				const expiresInSeconds = Math.max(
					1,
					Math.ceil(ttl.add(staleDuration).total({ unit: "seconds" })),
				);

				// Bun client automatically pipelines
				await Promise.all(
					entries.map(([key, value]) =>
						redis.setex(
							getKey(key),
							expiresInSeconds,
							JSON.stringify({
								value,
								expiresAt: Temporal.Now.instant().add(ttl).epochMilliseconds,
							}),
						),
					),
				);
			} catch (error) {
				// Redis connection failure - silently fail, data will be cached on next successful write
				getLogger().warn(
					{ err: error, prefix, entryCount: entries.length },
					"Redis cache setMultiple failed",
				);
			}
		},
	};

	return cache;
}
