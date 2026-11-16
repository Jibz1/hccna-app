import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { Context, DateTime, Effect, Layer, Predicate } from "effect";

import type { Cache, ResponseCachePluginExtensions } from "@graphql-yoga/plugin-response-cache";
import type { ExecutionResult } from "graphql";

type GraphQLCacheResult = ExecutionResult<
	NonNullable<ExecutionResult["data"]>,
	ResponseCachePluginExtensions
>;

interface CacheEntityRecord {
	readonly typename: string;
	readonly id?: string | number | undefined;
}

interface CachedResponsePayload {
	readonly data: GraphQLCacheResult;
	readonly expiresAt: number;
}

interface GraphQLResponseCacheServiceContract {
	readonly cache: Cache;
}

const RESPONSE_CACHE_PREFIX = "graphql:response-cache:result:v2";
const ENTITY_CACHE_PREFIX = "graphql:response-cache:entity:v2";

// The in-process LRU tier serves hot keys without a Redis round-trip, but
// invalidation (redis.del + local lru.delete) cannot reach OTHER replicas'
// LRUs. Capping the memory-tier TTL bounds that cross-replica staleness:
// after a mutation invalidates an entity, every replica converges on Redis
// within this window instead of serving its local copy until expiresAt
// (up to 2h for verse-of-the-day entries).
const LRU_TTL_CAP_MS = 30_000;

const getResponseCacheKey = (id: string) => `${RESPONSE_CACHE_PREFIX}:${id}`;
const getEntityCacheKey = (entity: CacheEntityRecord) =>
	`${ENTITY_CACHE_PREFIX}:${entity.typename}:${entity.id ?? "__typename__"}`;

const emptyIds = Object.freeze([]) as readonly string[];

function parseIds(value: string | null | undefined): readonly string[] {
	if (!value) {
		return emptyIds;
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) {
			return emptyIds;
		}
		return parsed.filter((entry) => Predicate.isString(entry));
	} catch {
		return emptyIds;
	}
}

class GraphQLResponseCacheService extends Context.Service<
	GraphQLResponseCacheService,
	GraphQLResponseCacheServiceContract
>()("GraphQLResponseCacheService", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const lru = yield* LRUService;

		const get = Effect.fn("GraphQLResponseCacheService.get")(function* (id: string) {
			const cacheKey = getResponseCacheKey(id);
			const cachedLru = yield* lru.get<CachedResponsePayload>(cacheKey);

			const lruNow = DateTime.toEpochMillis(yield* DateTime.now);

			if (cachedLru && cachedLru.expiresAt > lruNow) {
				return cachedLru.data;
			}

			const raw = yield* redis.get(cacheKey);

			if (!raw) {
				return null;
			}

			const payload = yield* Effect.try(() => JSON.parse(raw) as CachedResponsePayload);
			const redisNow = DateTime.toEpochMillis(yield* DateTime.now);

			if (payload.expiresAt <= redisNow) {
				yield* lru.delete(cacheKey);
				yield* redis.del(cacheKey);
				return null;
			}

			yield* lru.set(
				cacheKey,
				payload,
				Math.max(1, Math.min(payload.expiresAt - redisNow, LRU_TTL_CAP_MS)),
			);

			return payload.data;
		});

		const setEntry = Effect.fn("GraphQLResponseCacheService.set")(function* (input: {
			readonly id: string;
			readonly data: GraphQLCacheResult;
			readonly entities: Iterable<CacheEntityRecord>;
			readonly ttl: number;
		}) {
			const ttlSeconds = Math.max(1, Math.ceil(input.ttl / 1000));
			const now = DateTime.toEpochMillis(yield* DateTime.now);
			const expiresAt = now + input.ttl;
			const cacheKey = getResponseCacheKey(input.id);
			const payload: CachedResponsePayload = {
				data: input.data,
				expiresAt,
			};

			yield* lru.set(cacheKey, payload, Math.min(input.ttl, LRU_TTL_CAP_MS));

			yield* redis.setex(cacheKey, ttlSeconds, JSON.stringify(payload));

			for (const entity of input.entities) {
				const entityKey = getEntityCacheKey(entity);
				const existing = yield* redis.get(entityKey);
				const nextIds = new Set([...parseIds(existing), input.id]);
				const existingTtl = yield* redis
					.ttl(entityKey)
					.pipe(Effect.catch(() => Effect.succeed(-2)));
				const nextTtl = existingTtl > 0 ? Math.max(existingTtl, ttlSeconds) : ttlSeconds;
				yield* redis.setex(entityKey, nextTtl, JSON.stringify([...nextIds]));
			}
		});

		const invalidate = Effect.fn("GraphQLResponseCacheService.invalidate")(function* (
			entities: Iterable<CacheEntityRecord>,
		) {
			for (const entity of entities) {
				const entityKey = getEntityCacheKey(entity);
				const rawIds = yield* redis.get(entityKey);

				for (const id of parseIds(rawIds)) {
					const responseKey = getResponseCacheKey(id);
					yield* redis.del(responseKey);
					yield* lru.delete(responseKey);
				}

				yield* redis.del(entityKey);
			}
		});

		const cache: Cache = {
			get: (id) => Effect.runPromise(get(id).pipe(Effect.catch(() => Effect.succeed(null)))),
			set: (...[id, data, entities, ttl]) =>
				Effect.runPromise(
					setEntry({
						id,
						data,
						entities,
						ttl,
					}).pipe(Effect.catch(() => Effect.void)),
				),
			invalidate: (entities) =>
				Effect.runPromise(invalidate(entities).pipe(Effect.catch(() => Effect.void))),
		};

		return { cache } satisfies GraphQLResponseCacheServiceContract;
	}),
}) {}

export const GraphQLResponseCacheServiceLive = Layer.effect(
	GraphQLResponseCacheService,
	GraphQLResponseCacheService.make,
);

export const getGraphQLResponseCacheEffect = Effect.gen(function* () {
	const service = yield* GraphQLResponseCacheService;
	return service.cache;
});
