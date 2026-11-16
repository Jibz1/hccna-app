import { buildVersionedCacheKey, type CacheKeyPart } from "@/effect/cache/key";
import {
	getCacheObservabilityAttributes,
	type CacheBackendKind,
	type CachePolicy,
} from "@/effect/cache/policies";
import { DateTime, Deferred, Effect, Metric, Option, Predicate } from "effect";

import type { LRUServiceContract } from "@/effect/LRUService";
import type { RedisServiceContract } from "@/effect/RedisService";

type CacheSource = "loader" | "lru" | "redis";
type CacheFreshness = "fresh" | "stale";
type CacheOutcome = "hit" | "miss";
type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export interface CacheCodec<T> {
	readonly encode: (value: T) => unknown;
	readonly decode: <Input>(value: Input) => Option.Option<T>;
}

interface TwoTierCacheDependencies {
	readonly lru: LRUServiceContract;
	readonly redis: RedisServiceContract;
}

type CacheBackend =
	| {
			readonly kind: "lru";
			readonly lru: LRUServiceContract;
	  }
	| {
			readonly kind: "redis";
			readonly redis: RedisServiceContract;
	  }
	| {
			readonly kind: "two-tier";
			readonly lru: LRUServiceContract;
			readonly redis: RedisServiceContract;
	  };

interface StoredCacheEntry<T> {
	readonly data: T;
	readonly cachedAt: number;
	readonly expiresAt?: number | undefined;
	readonly staleUntil?: number | undefined;
}

interface CacheGetResult<T> {
	readonly value: T;
	readonly source: CacheSource;
	readonly freshness: CacheFreshness;
	readonly cacheKey: string;
}

interface CacheLoaderOptions<T> {
	readonly backgroundRevalidate?: boolean | undefined;
	readonly shouldCache?: ((value: T) => boolean) | undefined;
}

export interface CacheOptions<T> {
	readonly codec: CacheCodec<T>;
}

interface Cache<T> {
	readonly get: (
		key: CacheKeyPart | readonly CacheKeyPart[],
	) => Effect.Effect<CacheGetResult<T> | null>;
	readonly set: (key: CacheKeyPart | readonly CacheKeyPart[], value: T) => Effect.Effect<void>;
	readonly getOrLoad: <E, R>(
		key: CacheKeyPart | readonly CacheKeyPart[],
		loader: Effect.Effect<T, E, R>,
		options?: CacheLoaderOptions<T>,
	) => Effect.Effect<CacheGetResult<T>, E, R>;
	readonly invalidate: (key: CacheKeyPart | readonly CacheKeyPart[]) => Effect.Effect<void>;
}

export type TwoTierCache<T> = Cache<T>;

const DEFAULT_BACKGROUND_REVALIDATE = true;
const cacheRequestsTotal = Metric.counter("cache_requests_total", {
	description: "Cache reads by backend, source, freshness, and outcome",
	incremental: true,
});
const cacheWritesTotal = Metric.counter("cache_writes_total", {
	description: "Cache writes and invalidations by backend",
	incremental: true,
});
const jsonCacheCodec = {
	encode: (value: JsonValue) => value,
	decode: <Input>(value: Input) => Option.some(value as JsonValue),
} satisfies CacheCodec<JsonValue>;

function backendHasLru(
	backend: CacheBackend,
): backend is Extract<CacheBackend, { readonly lru: LRUServiceContract }> {
	return "lru" in backend;
}

function backendHasRedis(
	backend: CacheBackend,
): backend is Extract<CacheBackend, { readonly redis: RedisServiceContract }> {
	return "redis" in backend;
}

function toKeyParts(key: CacheKeyPart | readonly CacheKeyPart[]) {
	return Array.isArray(key) ? key : [key];
}

function getTtlWithJitter(policy: CachePolicy): number {
	if (!policy.jitterPct) {
		return policy.ttlMs;
	}

	const boundedJitter = Math.max(0, Math.min(policy.jitterPct, 1));
	const maxDelta = policy.ttlMs * boundedJitter;
	const delta = Math.floor(Math.random() * maxDelta);
	return Math.max(1, policy.ttlMs - delta);
}

function parseStoredEntry<T>(value: string | null | undefined, codec: CacheCodec<T>) {
	if (!value) {
		return null;
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		if (
			!Predicate.isObject(parsed) ||
			!("data" in parsed) ||
			!Predicate.isNumber(parsed.cachedAt)
		) {
			return null;
		}

		const decodedData = codec.decode(parsed.data);
		if (Option.isNone(decodedData)) {
			return null;
		}

		return {
			data: decodedData.value,
			cachedAt: parsed.cachedAt,
			expiresAt: Predicate.isNumber(parsed.expiresAt) ? parsed.expiresAt : undefined,
			staleUntil: Predicate.isNumber(parsed.staleUntil) ? parsed.staleUntil : undefined,
		} satisfies StoredCacheEntry<T>;
	} catch {
		return null;
	}
}

function serializeStoredEntry<T>(entry: StoredCacheEntry<T>, codec: CacheCodec<T>): string | null {
	try {
		return JSON.stringify({
			...entry,
			data: codec.encode(entry.data),
		});
	} catch {
		return null;
	}
}

function getExpiresAt(entry: StoredCacheEntry<unknown>, policy: CachePolicy): number {
	return entry.expiresAt ?? entry.cachedAt + policy.ttlMs;
}

function getStaleUntil(entry: StoredCacheEntry<unknown>, policy: CachePolicy): number {
	return entry.staleUntil ?? getExpiresAt(entry, policy) + policy.swrMs;
}

function getEntryFreshness(
	entry: StoredCacheEntry<unknown>,
	now: number,
	policy: CachePolicy,
): CacheFreshness | null {
	const expiresAt = getExpiresAt(entry, policy);

	if (expiresAt > now) {
		return "fresh";
	}

	if (getStaleUntil(entry, policy) > now) {
		return "stale";
	}

	return null;
}

function makeStoredEntry<T>(value: T, policy: CachePolicy, now: number): StoredCacheEntry<T> {
	const ttlMs = getTtlWithJitter(policy);
	const expiresAt = now + ttlMs;

	return {
		data: value,
		cachedAt: now,
		expiresAt,
		staleUntil: expiresAt + policy.swrMs,
	};
}

function createCache<T>(
	backend: Extract<CacheBackend, { readonly kind: "lru" }>,
	policy: CachePolicy,
): Cache<T>;
function createCache<T extends JsonValue>(backend: CacheBackend, policy: CachePolicy): Cache<T>;
function createCache<T>(
	backend: CacheBackend,
	policy: CachePolicy,
	options: CacheOptions<T>,
): Cache<T>;
function createCache<T>(
	backend: CacheBackend,
	policy: CachePolicy,
	options?: CacheOptions<T>,
): Cache<T> {
	const codec = (options?.codec ?? jsonCacheCodec) as CacheCodec<T>;
	const inFlightLoads = new Map<string, Deferred.Deferred<CacheGetResult<T>, unknown>>();
	const cacheBackend = backend.kind satisfies CacheBackendKind;
	// Revisit Redis regularly so another replica's invalidation reaches this
	// process within 30 seconds, even when the shared entry has a long SWR TTL.
	const lruTtl = (ttlMs: number) => (cacheBackend === "two-tier" ? Math.min(ttlMs, 30_000) : ttlMs);
	const baseObservability = getCacheObservabilityAttributes(policy, cacheBackend);

	const getCacheKey = (key: CacheKeyPart | readonly CacheKeyPart[]) =>
		buildVersionedCacheKey(policy.keyPrefix, policy.version, toKeyParts(key));

	const annotateCacheSpan = (
		cacheKey: string,
		attributes: {
			readonly cacheOutcome?: CacheOutcome | undefined;
			readonly cacheSource?: CacheSource | "none" | undefined;
			readonly cacheFreshness?: CacheFreshness | "none" | undefined;
			readonly cacheOperation?: string | undefined;
		},
	) =>
		Effect.all(
			[
				Effect.annotateCurrentSpan("cache.name", baseObservability.cacheName),
				Effect.annotateCurrentSpan("cache.backend", baseObservability.cacheBackend),
				Effect.annotateCurrentSpan("cache.strategy", baseObservability.cacheStrategy),
				Effect.annotateCurrentSpan("cache.key", cacheKey),
				attributes.cacheOperation
					? Effect.annotateCurrentSpan("cache.operation", attributes.cacheOperation)
					: Effect.void,
				attributes.cacheOutcome
					? Effect.annotateCurrentSpan("cache.outcome", attributes.cacheOutcome)
					: Effect.void,
				attributes.cacheSource
					? Effect.annotateCurrentSpan("cache.source", attributes.cacheSource)
					: Effect.void,
				attributes.cacheFreshness
					? Effect.annotateCurrentSpan("cache.freshness", attributes.cacheFreshness)
					: Effect.void,
			],
			{ concurrency: 1 },
		).pipe(Effect.asVoid);

	const recordCacheRead = (
		cacheKey: string,
		result: CacheGetResult<T> | null,
	): Effect.Effect<void> => {
		const cacheOutcome: CacheOutcome = result ? "hit" : "miss";
		const cacheSource = result?.source ?? "none";
		const cacheFreshness = result?.freshness ?? "none";

		return Effect.gen(function* () {
			yield* Metric.withAttributes(cacheRequestsTotal, {
				...baseObservability,
				cacheOutcome,
				cacheSource,
				cacheFreshness,
			}).pipe(Metric.update(1));
			yield* Effect.logDebug(result ? "Cache hit" : "Cache miss").pipe(
				Effect.annotateLogs({
					...baseObservability,
					cacheKey,
					cacheOutcome,
					cacheSource,
					cacheFreshness,
				}),
			);
			yield* annotateCacheSpan(cacheKey, {
				cacheOperation: "get",
				cacheOutcome,
				cacheSource,
				cacheFreshness,
			});
		});
	};

	const recordCacheWrite = (
		cacheKey: string,
		cacheOperation: "invalidate" | "set",
	): Effect.Effect<void> =>
		Effect.gen(function* () {
			yield* Metric.withAttributes(cacheWritesTotal, {
				...baseObservability,
				cacheOperation,
			}).pipe(Metric.update(1));
			yield* Effect.logDebug(cacheOperation === "set" ? "Cache write" : "Cache invalidation").pipe(
				Effect.annotateLogs({
					...baseObservability,
					cacheKey,
					cacheOperation,
				}),
			);
			yield* annotateCacheSpan(cacheKey, { cacheOperation });
		});

	const logFailOpen = (
		operation: string,
		cacheKey: string,
		error: { readonly _tag: string; readonly operation?: string },
	) =>
		Effect.logDebug("Cache operation failed open").pipe(
			Effect.annotateLogs({
				cacheName: policy.name,
				operation,
				cacheKey,
				cacheBackend: baseObservability.cacheBackend,
				cacheStrategy: baseObservability.cacheStrategy,
				errorTag: error._tag,
				errorOperation: error.operation,
			}),
		);

	const deleteBoth = (cacheKey: string): Effect.Effect<void> =>
		Effect.all(
			[
				backendHasLru(backend)
					? backend.lru
							.delete(cacheKey)
							.pipe(
								Effect.catchTag("LRUError", (error) => logFailOpen("lru.delete", cacheKey, error)),
							)
					: Effect.void,
				backendHasRedis(backend)
					? backend.redis
							.del(cacheKey)
							.pipe(
								Effect.catchTag("RedisError", (error) => logFailOpen("redis.del", cacheKey, error)),
							)
					: Effect.void,
			],
			{ concurrency: 2 },
		).pipe(
			Effect.asVoid,
			Effect.andThen(recordCacheWrite(cacheKey, "invalidate")),
		) as Effect.Effect<void>;

	const deleteRedisOnly = (cacheKey: string): Effect.Effect<void> =>
		backendHasRedis(backend)
			? backend.redis
					.del(cacheKey)
					.pipe(Effect.catchTag("RedisError", (error) => logFailOpen("redis.del", cacheKey, error)))
			: Effect.void;

	const setByCacheKey = (cacheKey: string, value: T): Effect.Effect<void> =>
		Effect.gen(function* () {
			const now = DateTime.toEpochMillis(yield* DateTime.now);
			const entry = makeStoredEntry(value, policy, now);
			const ttlSeconds = Math.max(
				1,
				Math.ceil(((entry.staleUntil ?? entry.expiresAt ?? now) - now) / 1000),
			);
			const serializedEntry = backendHasRedis(backend) ? serializeStoredEntry(entry, codec) : null;
			const setRedis = (() => {
				if (backendHasRedis(backend)) {
					if (serializedEntry === null) {
						return Effect.logWarning("Cache Redis serialization skipped").pipe(
							Effect.annotateLogs({
								...baseObservability,
								operation: "redis.serialize",
								cacheKey,
							}),
						);
					}

					return backend.redis
						.setex(cacheKey, ttlSeconds, serializedEntry)
						.pipe(
							Effect.catchTag("RedisError", (error) => logFailOpen("redis.setex", cacheKey, error)),
						);
				}

				return Effect.void;
			})();

			yield* Effect.all(
				[
					backendHasLru(backend)
						? backend.lru
								.set(cacheKey, entry, lruTtl(ttlSeconds * 1000))
								.pipe(
									Effect.catchTag("LRUError", (error) => logFailOpen("lru.set", cacheKey, error)),
								)
						: Effect.void,
					setRedis,
				],
				{ concurrency: 2 },
			);
			yield* recordCacheWrite(cacheKey, "set");
		}).pipe(
			Effect.withSpan(`Cache.${policy.name}.set`, {
				attributes: { cacheKey },
			}),
		) as Effect.Effect<void>;

	const getFromLru = (cacheKey: string, now: number): Effect.Effect<CacheGetResult<T> | null> =>
		backendHasLru(backend)
			? backend.lru.get<StoredCacheEntry<T>>(cacheKey).pipe(
					Effect.map((entry): CacheGetResult<T> | null => {
						if (!entry) {
							return null;
						}

						const freshness = getEntryFreshness(entry, now, policy);
						return freshness
							? {
									value: entry.data,
									source: "lru",
									freshness,
									cacheKey,
								}
							: null;
					}),
					Effect.catchTag("LRUError", (error) =>
						logFailOpen("lru.get", cacheKey, error).pipe(Effect.as(null)),
					),
				)
			: Effect.succeed(null);

	const getFromRedis = (cacheKey: string, now: number): Effect.Effect<CacheGetResult<T> | null> =>
		backendHasRedis(backend)
			? backend.redis.get(cacheKey).pipe(
					Effect.flatMap((value) => {
						const entry = parseStoredEntry<T>(value, codec);
						if (!entry) {
							return value
								? deleteRedisOnly(cacheKey).pipe(Effect.as(null))
								: Effect.succeed<CacheGetResult<T> | null>(null);
						}

						const freshness = getEntryFreshness(entry, now, policy);
						if (!freshness) {
							return deleteRedisOnly(cacheKey).pipe(Effect.as(null));
						}

						const remainingTtlMs = Math.max(1, getStaleUntil(entry, policy) - now);
						const hydrateLru = backendHasLru(backend)
							? backend.lru
									.set(cacheKey, entry, lruTtl(remainingTtlMs))
									.pipe(
										Effect.catchTag("LRUError", (error) =>
											logFailOpen("lru.setFromRedis", cacheKey, error),
										),
									)
							: Effect.void;

						return hydrateLru.pipe(
							Effect.as({
								value: entry.data,
								source: "redis",
								freshness,
								cacheKey,
							} satisfies CacheGetResult<T>),
						);
					}),
					Effect.catchTag("RedisError", (error) =>
						logFailOpen("redis.get", cacheKey, error).pipe(Effect.as(null)),
					),
				)
			: Effect.succeed(null);

	const getByCacheKey = (cacheKey: string): Effect.Effect<CacheGetResult<T> | null> =>
		Effect.gen(function* () {
			const now = DateTime.toEpochMillis(yield* DateTime.now);
			const lruResult = yield* getFromLru(cacheKey, now);
			if (lruResult) {
				yield* recordCacheRead(cacheKey, lruResult);
				return lruResult;
			}

			const redisResult = yield* getFromRedis(cacheKey, now);
			yield* recordCacheRead(cacheKey, redisResult);
			return redisResult;
		}).pipe(
			Effect.withSpan(`Cache.${policy.name}.get`, {
				attributes: { cacheKey },
			}),
		);

	const loadWithSingleFlight = <E, R>(
		cacheKey: string,
		loader: Effect.Effect<T, E, R>,
		shouldCache: (value: T) => boolean,
	): Effect.Effect<CacheGetResult<T>, E, R> =>
		Effect.gen(function* () {
			const existing = inFlightLoads.get(cacheKey) as
				| Deferred.Deferred<CacheGetResult<T>, E>
				| undefined;
			if (existing) {
				return yield* Deferred.await(existing);
			}

			const deferred = yield* Deferred.make<CacheGetResult<T>, E>();
			inFlightLoads.set(cacheKey, deferred as never);

			const load = Effect.gen(function* () {
				const value = yield* loader;
				yield* Effect.logDebug("Cache loader resolved").pipe(
					Effect.annotateLogs({
						...baseObservability,
						cacheKey,
						cacheSource: "loader",
						cacheFreshness: "fresh",
					}),
				);
				yield* shouldCache(value) ? setByCacheKey(cacheKey, value) : deleteBoth(cacheKey);

				return {
					value,
					source: "loader" as const,
					freshness: "fresh" as const,
					cacheKey,
				};
			});

			yield* Deferred.complete(deferred, load).pipe(
				Effect.ensuring(Effect.sync(() => inFlightLoads.delete(cacheKey))),
			);

			return yield* Deferred.await(deferred);
		});

	const getOrLoad = <E, R>(
		key: CacheKeyPart | readonly CacheKeyPart[],
		loader: Effect.Effect<T, E, R>,
		loaderOptions: CacheLoaderOptions<T> = {},
	): Effect.Effect<CacheGetResult<T>, E, R> =>
		Effect.gen(function* () {
			const cacheKey = getCacheKey(key);
			const cached = yield* getByCacheKey(cacheKey);
			const shouldCache = loaderOptions.shouldCache ?? (() => true);

			if (cached?.freshness === "fresh") {
				return cached;
			}

			if (cached?.freshness === "stale") {
				if (loaderOptions.backgroundRevalidate ?? DEFAULT_BACKGROUND_REVALIDATE) {
					yield* Effect.forkDetach(
						loadWithSingleFlight(cacheKey, loader, shouldCache).pipe(
							Effect.ignore({
								log: "Debug",
								message: `Cache.${policy.name}.backgroundRevalidate failed`,
							}),
						),
					);
				}

				return cached;
			}

			return yield* loadWithSingleFlight(cacheKey, loader, shouldCache);
		});

	return {
		get: (key) => getByCacheKey(getCacheKey(key)),
		set: (key, value) => setByCacheKey(getCacheKey(key), value),
		getOrLoad,
		invalidate: (key) => deleteBoth(getCacheKey(key)),
	};
}

export function createTwoTierCache<T extends JsonValue>(
	dependencies: TwoTierCacheDependencies,
	policy: CachePolicy,
): TwoTierCache<T>;
export function createTwoTierCache<T>(
	dependencies: TwoTierCacheDependencies,
	policy: CachePolicy,
	options: CacheOptions<T>,
): TwoTierCache<T>;
export function createTwoTierCache<T>(
	dependencies: TwoTierCacheDependencies,
	policy: CachePolicy,
	options?: CacheOptions<T>,
): TwoTierCache<T> {
	const backend = {
		kind: "two-tier",
		lru: dependencies.lru,
		redis: dependencies.redis,
	} satisfies CacheBackend;

	const cache = options ? createCache(backend, policy, options) : createCache(backend, policy);
	return cache as TwoTierCache<T>;
}
