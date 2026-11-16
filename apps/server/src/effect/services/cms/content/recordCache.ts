import { RedisService } from "@/effect/RedisService";
import { CmsContentError, type CmsCacheArea } from "@/effect/services/cms/content/CmsContent";
import { Effect, Option, Schema } from "effect";
import { LRUCache } from "lru-cache";

// Bump the version whenever a record's shape changes: old entries then miss instead of misreading.
const KEY_PREFIX = "cms-v5:3";
// Each area's clear count across instances. Outside KEY_PREFIX, so a clear never deletes it.
const GENERATION_PREFIX = "cms-v5:generation";
const MEMORY_MAX_ENTRIES = 500;
const MEMORY_TTL_MS = 10 * 60 * 1000;
const REDIS_TTL_SECONDS = 70 * 60;
// A Redis that stops answering must not stall CMS reads: past this, a read is a miss and a
// write is skipped, both logged like a Redis failure.
const REDIS_TIMEOUT = "500 millis";

type KeyPart = string | number | undefined;

/** A record's memory and Redis key, with the area whose clears it follows. */
interface RecordCacheKey {
	readonly area: CmsCacheArea;
	readonly key: string;
}

export const recordCacheKey = (
	area: CmsCacheArea,
	parts: readonly KeyPart[] = [],
): RecordCacheKey => ({
	area,
	key: `${KEY_PREFIX}:${area}:${parts.map((part) => part ?? "").join("|")}`,
});

const generationKey = (area: CmsCacheArea) => `${GENERATION_PREFIX}:${area}`;

// One Redis call, bounded by REDIS_TIMEOUT; a failure or a timeout is logged and is `None`.
const tryRedis = <A, E extends { readonly message: string }>(
	effect: Effect.Effect<A, E>,
	failed: string,
	key: string,
): Effect.Effect<Option.Option<A>> =>
	effect.pipe(
		Effect.timeout(REDIS_TIMEOUT),
		Effect.asSome,
		Effect.catch((error) =>
			Effect.logWarning(failed).pipe(
				Effect.annotateLogs({ key, error: error.message }),
				Effect.as(Option.none()),
			),
		),
	);

// `None` (not JSON, or not this record shape) is a miss.
const decode = <A>(schema: Schema.Codec<A>, raw: string): Effect.Effect<Option.Option<A>> =>
	Effect.option(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(raw));

/**
 * Two-tier cache of finished records (not raw CMS JSON): memory, then Redis. Redis read and
 * write failures and timeouts are logged and count as misses, so a Redis outage never fails
 * or stalls a read.
 *
 * A load that overlaps a clear of its area returns its data but caches it nowhere: it may
 * predate the change the clear was for. Each instance counts its own clears per area, and Redis
 * counts every instance's; a load is cached only when neither count moved while it ran (the
 * shared one only when both of its readings arrived).
 */
export const makeRecordCache = Effect.gen(function* () {
	const redis = yield* RedisService;
	const memory = new LRUCache<string, string>({ max: MEMORY_MAX_ENTRIES, ttl: MEMORY_TTL_MS });
	const clears = new Map<CmsCacheArea, number>();
	const clearsOf = (area: CmsCacheArea) => clears.get(area) ?? 0;

	// A missing counter means no clear yet: "0".
	const readGeneration = (area: CmsCacheArea) =>
		tryRedis(
			redis.get(generationKey(area)),
			"Strapi 5 cache generation read failed",
			generationKey(area),
		).pipe(Effect.map(Option.map((generation) => generation ?? "0")));

	const cached = <A>(
		{ area, key }: RecordCacheKey,
		schema: Schema.Codec<A>,
		load: Effect.Effect<A, CmsContentError>,
	): Effect.Effect<A, CmsContentError> =>
		Effect.gen(function* () {
			const fromMemory = memory.get(key);
			if (fromMemory !== undefined) {
				const hit = yield* decode(schema, fromMemory);
				if (Option.isSome(hit)) {
					return hit.value;
				}
			}

			// One round trip: the entry, and the area's shared clear count before any load.
			const read = yield* tryRedis(
				redis.mget([key, generationKey(area)]),
				"Strapi 5 cache read failed",
				key,
			);
			const fromRedis = Option.isSome(read) ? (read.value[0] ?? null) : null;
			if (fromRedis !== null) {
				const hit = yield* decode(schema, fromRedis);
				if (Option.isSome(hit)) {
					memory.set(key, fromRedis);
					return hit.value;
				}
			}

			const sharedBefore = read.pipe(Option.map((values) => values[1] ?? "0"));
			const localBefore = clearsOf(area);
			const fresh = yield* load;
			const sharedAfter = Option.isSome(sharedBefore)
				? yield* readGeneration(area)
				: Option.none<string>();
			const sharedMoved =
				Option.isSome(sharedBefore) &&
				Option.isSome(sharedAfter) &&
				sharedBefore.value !== sharedAfter.value;
			if (sharedMoved || clearsOf(area) !== localBefore) {
				return fresh;
			}
			const raw = JSON.stringify(fresh);
			memory.set(key, raw);
			yield* tryRedis(redis.setex(key, REDIS_TTL_SECONDS, raw), "Strapi 5 cache write failed", key);
			return fresh;
		});

	// Memory by prefix, then Redis by KEYS pattern. Memory goes
	// first so this instance serves fresh records even when the Redis half fails. Each clear count
	// moves before its tier's entries are deleted, so a load still running sees it when it finishes.
	const clear = (area: CmsCacheArea): Effect.Effect<void, CmsContentError> =>
		Effect.gen(function* () {
			clears.set(area, clearsOf(area) + 1);
			const prefix = recordCacheKey(area).key;
			const inMemory = [...memory.keys()].filter((key) => key.startsWith(prefix));
			for (const key of inMemory) {
				memory.delete(key);
			}
			yield* tryRedis(
				redis.incr(generationKey(area)),
				"Strapi 5 cache generation bump failed",
				generationKey(area),
			);
			const inRedis = yield* redis.keys(`${prefix}*`);
			yield* Effect.forEach(inRedis, (key) => redis.del(key), { discard: true });
		}).pipe(
			Effect.mapError(
				(cause) =>
					new CmsContentError({
						reason: "Unavailable",
						operation: `invalidate.${area}`,
						detail: "Failed to clear the Strapi 5 cache",
						cause,
					}),
			),
		);

	return { cached, clear };
});
