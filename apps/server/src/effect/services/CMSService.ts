import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { createCmsCacheHelpers } from "@/effect/services/cms/cache";
import {
	CORE_LRU_CACHE_KEY,
	CORE_REDIS_CACHE_KEY,
	HOME_LRU_CACHE_KEY,
	HOME_REDIS_CACHE_KEY,
	SERMON_STELLATE_OPERATION_NAMES,
} from "@/effect/services/cms/constants";
import { CmsContent, type CmsContentError } from "@/effect/services/cms/content/CmsContent";
import { makeFeaturedEventFeeds } from "@/effect/services/cms/featuredEventFeeds";
import {
	HOME_FEATURED_SOURCE,
	campusFeaturedSource,
} from "@/effect/services/cms/featuredEventRepository";
import {
	extractProminentColorsFromImageUrl,
	hasCompleteStoredProminentColors,
	mergeProminentColors,
	type StoredProminentColors,
} from "@/effect/services/cms/prominentColors";
import {
	fetchCoreSettingsRow,
	fetchUpcomingEventRows,
	upsertCoreSettings,
} from "@/effect/services/cms/repositories";
import {
	coreSettingsColumns,
	transformCardsToFeaturedEvents,
	transformDbCoreSettings,
	transformDbFeaturedEvents,
	transformDbResults,
} from "@/effect/services/cms/transforms";
import { CMSFetchError, type CMSNotFoundError } from "@/effect/services/CMSErrors";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { purgeStellateOperations } from "@/utils/stellate";
import { Context, Effect, Layer } from "effect";

import type { CoreData, FeaturedEvent, HomeData } from "@/effect/services/cms/types";

type FeaturedEventsData = ReturnType<typeof transformCardsToFeaturedEvents>[number];

type ExistingFeaturedEventColorRow = StoredProminentColors & {
	eventImageUrl: string;
};

const formatCause = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Logs a failed cache clear that runs after the real work, which keeps its result. */
export const logCacheWarning = (message: string, operation: string) => (error: CmsContentError) =>
	Effect.logWarning(message).pipe(
		Effect.annotateLogs({
			operation,
			cmsOperation: error.operation,
			detail: error.detail,
			cause: formatCause(error.cause),
		}),
	);

const failWithCmsFetchError = (detail: string, operation: string) => (error: CmsContentError) =>
	Effect.gen(function* () {
		yield* Effect.logError(detail).pipe(
			Effect.annotateLogs({
				operation,
				cmsOperation: error.operation,
				reason: error.reason,
				detail: error.detail,
				cause: formatCause(error.cause),
			}),
		);

		return yield* Effect.fail(new CMSFetchError({ detail, cause: error }));
	});

function attachProminentColors(
	event: FeaturedEventsData,
	existing?: ExistingFeaturedEventColorRow,
) {
	return Effect.gen(function* () {
		if (hasCompleteStoredProminentColors(existing)) {
			return { ...event, ...existing };
		}

		const extracted: StoredProminentColors = yield* Effect.tryPromise(() =>
			extractProminentColorsFromImageUrl(event.eventImageUrl),
		).pipe(
			Effect.catch((error) =>
				Effect.logWarning("Failed to extract Featured Event prominent colors").pipe(
					Effect.annotateLogs({
						operation: "hydrateFeaturedEventProminentColors",
						imageUrl: event.eventImageUrl,
						error: error instanceof Error ? error.message : String(error),
					}),
					Effect.as({
						prominentColorDark: null,
						prominentColorLight: null,
						prominentColorAccent: null,
					}),
				),
			),
		);

		const prominentColors = mergeProminentColors(
			existing,
			extracted,
			existing ? "fill-missing" : "replace",
		);

		return { ...event, ...prominentColors };
	});
}

// ═══════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════

// Re-export public CMS data types for backwards compatibility
export type { CoreData } from "@/effect/services/cms/types";

// ═══════════════════════════════════════════════════════════════
// SERVICE DEFINITION
// ═══════════════════════════════════════════════════════════════

interface CMSServiceContract {
	getCoreSettings: Effect.Effect<CoreData, CMSFetchError | CMSNotFoundError>;
	getHomeData: Effect.Effect<HomeData, CMSFetchError | CMSNotFoundError>;
	getFeaturedEvents: (
		campusSlug?: string | null,
	) => Effect.Effect<FeaturedEvent[], CMSFetchError | CMSNotFoundError>;
	getFeaturedEventsFromStrapi: (
		campusSlug?: string | null,
	) => Effect.Effect<FeaturedEvent[], CMSFetchError>;
	refreshHomeData: Effect.Effect<void, CMSFetchError>;
	refreshCampusFeaturedEvents: (slug: string) => Effect.Effect<void, CMSFetchError>;
	refreshCoreSettings: Effect.Effect<void, CMSFetchError>;
	clearHomeDataCache: Effect.Effect<void, unknown>;
	clearCoreSettingsCache: Effect.Effect<void, unknown>;
	clearSermonsCache: Effect.Effect<void, CmsContentError>;
	clearCampusesCache: Effect.Effect<void, CmsContentError>;
}

export class CMSService extends Context.Service<CMSService, CMSServiceContract>()("CMSService", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const lru = yield* LRUService;
		const content = yield* CmsContent;
		const drizzle = yield* DrizzleService;
		const featuredFeeds = yield* makeFeaturedEventFeeds;

		// ─────────────────────────────────────────────────────────────
		// Core Settings Implementation
		// ─────────────────────────────────────────────────────────────

		const coreCache = createCmsCacheHelpers<CoreData>(
			{ lru, redis },
			CORE_LRU_CACHE_KEY,
			CORE_REDIS_CACHE_KEY,
		);

		const fetchCoreFromPostgres = Effect.gen(function* () {
			const data = yield* fetchCoreSettingsRow.pipe(Effect.provideService(DrizzleService, drizzle));
			return transformDbCoreSettings(data);
		}).pipe(Effect.withSpan("CMSService.fetchCoreFromPostgres"));

		const getCoreSettings = Effect.gen(function* () {
			// 1. Check LRU cache
			const lruData = yield* coreCache.getFromLRU;
			if (lruData) {
				yield* Effect.logDebug("LRU cache hit").pipe(
					Effect.annotateLogs({ operation: "getCoreSettings" }),
				);
				return lruData;
			}

			// 2. Check Redis cache
			const redisData = yield* coreCache.getFromRedis;
			if (redisData) {
				yield* Effect.logDebug("Redis cache hit").pipe(
					Effect.annotateLogs({ operation: "getCoreSettings" }),
				);
				yield* coreCache.setToLRU(redisData);
				return redisData;
			}

			// 3. Fetch from PostgreSQL
			yield* Effect.logDebug("Cache miss, fetching from Postgres").pipe(
				Effect.annotateLogs({ operation: "getCoreSettings" }),
			);
			const freshData = yield* fetchCoreFromPostgres;

			// Populate both caches
			yield* Effect.all([coreCache.setToLRU(freshData), coreCache.setToRedis(freshData)]);

			return freshData;
		}).pipe(Effect.withSpan("CMSService.getCoreSettings"));

		// ─────────────────────────────────────────────────────────────
		// Home Data Implementation
		// ─────────────────────────────────────────────────────────────

		const homeCache = createCmsCacheHelpers<HomeData>(
			{ lru, redis },
			HOME_LRU_CACHE_KEY,
			HOME_REDIS_CACHE_KEY,
		);

		const fetchHomeFromPostgres = Effect.gen(function* () {
			const upcoming = yield* fetchUpcomingEventRows.pipe(
				Effect.provideService(DrizzleService, drizzle),
			);
			return transformDbResults([], upcoming);
		}).pipe(Effect.withSpan("CMSService.fetchHomeFromPostgres"));

		const getCachedHomeData = Effect.gen(function* () {
			// 1. Check LRU cache
			const lruData = yield* homeCache.getFromLRU;
			if (lruData) {
				yield* Effect.logDebug("LRU cache hit").pipe(
					Effect.annotateLogs({ operation: "getHomeData" }),
				);
				return lruData;
			}

			// 2. Check Redis cache
			const redisData = yield* homeCache.getFromRedis;
			if (redisData) {
				yield* Effect.logDebug("Redis cache hit").pipe(
					Effect.annotateLogs({ operation: "getHomeData" }),
				);
				yield* homeCache.setToLRU(redisData);
				return redisData;
			}

			// 3. Fetch from PostgreSQL
			yield* Effect.logDebug("Cache miss, fetching from Postgres").pipe(
				Effect.annotateLogs({ operation: "getHomeData" }),
			);
			const freshData = yield* fetchHomeFromPostgres;

			// Populate both caches
			yield* Effect.all([homeCache.setToLRU(freshData), homeCache.setToRedis(freshData)]);

			return freshData;
		}).pipe(Effect.withSpan("CMSService.getHomeData"));

		const getFeaturedEvents = featuredFeeds.read;
		const getHomeData = Effect.gen(function* () {
			const [home, events] = yield* Effect.all([getCachedHomeData, getFeaturedEvents()], {
				concurrency: 2,
			});
			return { ...home, featuredEvents: { events } };
		});

		const getFeaturedEventsFromStrapi = Effect.fn("CMSService.getFeaturedEventsFromStrapi")(
			function* (campusSlug?: string | null) {
				const homeCards = yield* content.homeFeaturedCards.pipe(
					Effect.catchTag(
						"CmsContentError",
						failWithCmsFetchError(
							"Failed to fetch home featured events from Strapi",
							"getFeaturedEventsFromStrapi.fetchHome",
						),
					),
				);
				if (homeCards === null) {
					return yield* new CMSFetchError({
						detail: "Failed to fetch home featured events from Strapi - no data returned",
					});
				}
				let events = transformCardsToFeaturedEvents(homeCards);
				const slug = campusSlug?.trim();
				if (slug) {
					const campusCards = yield* content
						.campusFeaturedCards(slug)
						.pipe(
							Effect.catchTag(
								"CmsContentError",
								failWithCmsFetchError(
									"Failed to fetch campus featured events from Strapi",
									"getFeaturedEventsFromStrapi.fetchCampus",
								),
							),
						);
					if (campusCards.length > 0) {
						events = transformCardsToFeaturedEvents([
							...campusCards,
							...homeCards.filter((card) => card.allCampusEvent),
						]);
					}
				}

				const hydrated = yield* Effect.forEach(events, (event) => attachProminentColors(event), {
					concurrency: 3,
				});
				return transformDbFeaturedEvents(hydrated);
			},
		);

		// ─────────────────────────────────────────────────────────────
		// Refresh Home Data (featured cards snapshot, then the home cache)
		// ─────────────────────────────────────────────────────────────

		const refreshHomeData = Effect.gen(function* () {
			yield* featuredFeeds.refresh(HOME_FEATURED_SOURCE, true);
			// Clear cache after refreshing data
			yield* homeCache.clearStrict.pipe(
				Effect.mapError(
					(error) =>
						new CMSFetchError({
							detail: "Failed to clear home data cache after refresh",
							cause: error,
						}),
				),
			);
		}).pipe(Effect.withSpan("CMSService.refreshHomeData"));

		const clearCampusesCache = content
			.invalidate("campuses")
			.pipe(Effect.withSpan("CMSService.clearCampusesCache"));

		const refreshCampusFeaturedEvents = Effect.fn("CMSService.refreshCampusFeaturedEvents")(
			function* (slug: string) {
				const campusSlug = slug.trim();
				if (!campusSlug) {
					return yield* new CMSFetchError({
						detail: "Campus slug is required to refresh featured events",
					});
				}
				yield* featuredFeeds.refresh(campusFeaturedSource(campusSlug), true);
				yield* clearCampusesCache.pipe(
					Effect.catchTag(
						"CmsContentError",
						logCacheWarning(
							"Failed to clear campus cache",
							"refreshCampusFeaturedEvents.clearCache",
						),
					),
				);
			},
		);

		// ─────────────────────────────────────────────────────────────
		// Refresh Core Settings (fetch from Strapi and save to DB)
		// ─────────────────────────────────────────────────────────────

		const refreshCoreSettings = Effect.gen(function* () {
			yield* Effect.logDebug("Fetching core settings from Strapi").pipe(
				Effect.annotateLogs({ operation: "refreshCoreSettings" }),
			);

			const sections = yield* content.coreSections.pipe(
				Effect.catchTag(
					"CmsContentError",
					failWithCmsFetchError(
						"Failed to fetch core settings from Strapi",
						"refreshCoreSettings.fetch",
					),
				),
			);

			if (sections === null) {
				return yield* Effect.fail(
					new CMSFetchError({
						detail: "Failed to fetch Core data from Strapi - no data returned",
					}),
				);
			}

			const coreData = coreSettingsColumns(sections);

			yield* upsertCoreSettings(coreData).pipe(Effect.provideService(DrizzleService, drizzle));

			// Clear cache after refreshing data
			yield* coreCache.clearStrict.pipe(
				Effect.mapError(
					(error) =>
						new CMSFetchError({
							detail: "Failed to clear core settings cache after refresh",
							cause: error,
						}),
				),
			);

			yield* Effect.logDebug("Core settings refreshed from Strapi").pipe(
				Effect.annotateLogs({ operation: "refreshCoreSettings" }),
			);
		}).pipe(Effect.withSpan("CMSService.refreshCoreSettings"));

		// ─────────────────────────────────────────────────────────────
		// Cache Clearing
		// ─────────────────────────────────────────────────────────────

		const clearHomeDataCache = Effect.gen(function* () {
			yield* Effect.logDebug("Clearing home data cache").pipe(
				Effect.annotateLogs({ operation: "clearHomeDataCache" }),
			);
			yield* Effect.all([
				homeCache.clearStrict,
				Effect.tryPromise(() => purgeStellateOperations(["HomeQuery"])).pipe(
					Effect.catch((error) =>
						Effect.logWarning("Failed to purge Stellate operations").pipe(
							Effect.annotateLogs({
								operation: "clearHomeDataCache",
								target: "HomeQuery",
								error: String(error),
							}),
							Effect.asVoid,
						),
					),
				),
			]);
		}).pipe(Effect.withSpan("CMSService.clearHomeDataCache"));

		const clearCoreSettingsCache = Effect.gen(function* () {
			yield* Effect.logDebug("Clearing core settings cache").pipe(
				Effect.annotateLogs({ operation: "clearCoreSettingsCache" }),
			);
			yield* Effect.all([
				coreCache.clearStrict,
				Effect.tryPromise(() => purgeStellateOperations(["CoreDataQuery"])).pipe(
					Effect.catch((error) =>
						Effect.logWarning("Failed to purge Stellate operations").pipe(
							Effect.annotateLogs({
								operation: "clearCoreSettingsCache",
								target: "CoreDataQuery",
								error: String(error),
							}),
							Effect.asVoid,
						),
					),
				),
			]);
		}).pipe(Effect.withSpan("CMSService.clearCoreSettingsCache"));

		const clearSermonsCache = Effect.gen(function* () {
			yield* Effect.logDebug("Clearing sermons cache").pipe(
				Effect.annotateLogs({ operation: "clearSermonsCache" }),
			);

			yield* Effect.all([
				content.invalidate("sermons"),
				Effect.tryPromise(() => purgeStellateOperations([...SERMON_STELLATE_OPERATION_NAMES])).pipe(
					Effect.catch((error) =>
						Effect.logWarning("Failed to purge Stellate sermon operations").pipe(
							Effect.annotateLogs({
								operation: "clearSermonsCache",
								targets: SERMON_STELLATE_OPERATION_NAMES.join(","),
								error: formatCause(error),
							}),
							Effect.asVoid,
						),
					),
				),
			]);
		}).pipe(Effect.withSpan("CMSService.clearSermonsCache"));

		return {
			getCoreSettings,
			getHomeData,
			getFeaturedEvents,
			getFeaturedEventsFromStrapi,
			refreshHomeData,
			refreshCampusFeaturedEvents,
			refreshCoreSettings,
			clearHomeDataCache,
			clearCoreSettingsCache,
			clearSermonsCache,
			clearCampusesCache,
		};
	}),
}) {}

export const CMSServiceLive = Layer.effect(CMSService, CMSService.make);
