import { createInMemoryCache, type Cache } from "@graphql-yoga/plugin-response-cache";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export const responseCacheDefaultTtlMs = FIVE_MINUTES_MS;

/**
 * Per-field response-cache TTLs for @graphql-yoga/plugin-response-cache.
 *
 * `Query.castrStream` is pinned to 0 and must stay 0: its resolver performs a
 * source-fresh Strapi authorization read on every request, and a cached hit
 * skips the resolver entirely — serving revoked platform visibility and stream
 * keys for up to the TTL on the same token. Any future read-side caching must
 * be ACL-generation-keyed, not a raised TTL here.
 * See docs/streaming-migration-implementation-v3.md ("Caching and invalidation").
 */
export const responseCacheTtlPerSchemaCoordinate = {
	"Query.home": 15_000,
	"Query.featuredEvents": 15_000,
	"Query.core": TEN_MINUTES_MS,
	"Query.campuses": TEN_MINUTES_MS,
	"Query.campusesV2": TEN_MINUTES_MS,
	"Query.ccbFormsV2": TEN_MINUTES_MS,
	"Query.sermons": TEN_MINUTES_MS,
	// Shared by every caller and cached in ShortsService; see shorts.test.ts.
	"Query.shorts": 0,
	"Query.events": TEN_MINUTES_MS,
	"Query.upcomingEventsByMonth": TEN_MINUTES_MS,
	"Query.thoughtOfGod": TEN_MINUTES_MS,
	"Query.verseOfTheDay": TWO_HOURS_MS,
	"Query.verseOfTheDayV2": TWO_HOURS_MS,
	"Query.castrStream": 0,
	// Live status flips the moment a coordinator starts or ends a stream.
	"Query.liveStreamStatus": 0,
	"Query.user": 0,
	"Query.profile": 0,
	"User.profile": 0,
	"Query.getPreviousFiveYearsGivingV2": 0,
	"Query.myGivingHistory": 0,
	"Query.exportAttendance": 0,
};

let activeResponseCache: Cache = createInMemoryCache({ max: 500 });

export const responseCache: Cache = {
	get: (key) => activeResponseCache.get(key),
	set: (...args) => activeResponseCache.set(...args),
	invalidate: (entities) => activeResponseCache.invalidate(entities),
};

export function configureResponseCache(cache: Cache) {
	activeResponseCache = cache;
}
