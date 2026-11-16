import { donations, donationSyncLogs, donationYearlySummaries } from "@/db/schema/donations";
import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { CCBService } from "@/effect/services/CCBService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { parseGiving, type UserGiving } from "@/effect/services/giving/parseGiving";
import { lastGivingRefresh, untilNextGivingRefresh } from "@/effect/services/giving/weeklyRefresh";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import {
	Context,
	DateTime,
	Duration,
	Effect,
	Layer,
	Predicate,
	Result,
	Schema,
	Scope,
} from "effect";

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

// CCB giving only changes once a week, so every cache layer keeps a year until the next weekly refresh.

// v3: v2 payloads could hold gifts from other years (see parseGiving).
const REDIS_PREFIX = "donations-v3";
const DONATION_UPSERT_CHUNK_SIZE = 250;
const BACKGROUND_CACHE_TIMEOUT = "2 minutes";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface DonationCacheResult extends UserGiving {
	year: number;
	source: "lru-cache" | "redis" | "db" | "ccb";
	cachedAt: Date;
}

interface DonationCacheIdentity {
	userId: string;
	ccbFamilyId: string;
	ccbId: string;
	year: number;
}

class DonationCacheError extends Schema.TaggedError<DonationCacheError>()("DonationCacheError", {
	cause: Schema.optional(Schema.Unknown),
	message: Schema.String,
}) {}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

const getCacheKey = ({ userId, ccbFamilyId, ccbId, year }: DonationCacheIdentity) =>
	`${REDIS_PREFIX}:${userId}:${ccbFamilyId}:${ccbId}:${year}`;

const getCacheLogMetadata = (key: string) => ({
	cacheKeySize: key.length,
});

const isDbStale = (lastSyncedAt: Date): boolean =>
	lastSyncedAt.getTime() < lastGivingRefresh(DateTime.toEpochMillis(DateTime.nowUnsafe()));

const getRedisTtlSeconds = (nowMs: number): number =>
	Math.ceil(Duration.toSeconds(untilNextGivingRefresh(nowMs)));

const toCents = (amount: number | string): number => Math.round(Number(amount) * 100);

const formatUnknownError = (cause: unknown): string => {
	if (cause instanceof Error) {
		return cause.message;
	}

	if (!Predicate.isObject(cause)) {
		return String(cause);
	}

	return JSON.stringify(cause) ?? Object.prototype.toString.call(cause);
};

const FiniteNumberFromUnknownSchema = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

const NonNegativeIntFromUnknownSchema = FiniteNumberFromUnknownSchema.check(
	Schema.isInt(),
	Schema.isGreaterThanOrEqualTo(0),
);

const CacheConsistencyGivingSchema = Schema.Struct({
	amount: FiniteNumberFromUnknownSchema,
});

const CacheConsistencyPayloadSchema = Schema.Struct({
	giving: Schema.Array(CacheConsistencyGivingSchema),
	total: FiniteNumberFromUnknownSchema,
	numberOfGiving: NonNegativeIntFromUnknownSchema,
});

type CacheConsistencyPayload = typeof CacheConsistencyPayloadSchema.Type;
type RedisDonationCachePayload = Omit<DonationCacheResult, "cachedAt"> & {
	cachedAt: string;
};

const DonationGivingCacheEntrySchema = Schema.Struct({
	amount: FiniteNumberFromUnknownSchema,
	date: Schema.String,
	name: Schema.String,
	transactionId: Schema.String,
	taxDeductible: Schema.Boolean,
	paymentType: Schema.optional(Schema.String),
	campus: Schema.String,
	campusId: Schema.String,
});

const MutableDonationGivingEntriesSchema = Schema.mutable(
	Schema.Array(DonationGivingCacheEntrySchema),
);

const RedisDonationCacheEnvelopeSchema = Schema.Struct({
	giving: MutableDonationGivingEntriesSchema,
	total: FiniteNumberFromUnknownSchema,
	numberOfGiving: NonNegativeIntFromUnknownSchema,
	ccbId: Schema.String,
	year: NonNegativeIntFromUnknownSchema,
	source: Schema.Literals(["lru-cache", "redis", "db", "ccb"]),
	cachedAt: Schema.String,
});

const RedisDonationCachePayloadSchema = Schema.fromJsonString(RedisDonationCacheEnvelopeSchema);

const parseCacheConsistencyPayload = <Input>(data: Input) =>
	Schema.decodeUnknownResult(CacheConsistencyPayloadSchema)(data);

const parseRedisDonationCachePayload = <Input>(data: Input) =>
	Schema.decodeUnknownResult(RedisDonationCachePayloadSchema)(data);

const toDonationCacheResultFromRedis = (
	data: typeof RedisDonationCachePayloadSchema.Type,
): RedisDonationCachePayload => ({
	...data,
	giving: data.giving.map(({ paymentType, ...donation }) => {
		if (paymentType === undefined) {
			return donation;
		}

		return { ...donation, paymentType };
	}),
});

const getResultConsistency = (data: CacheConsistencyPayload) => {
	const computedCount = data.giving.length;
	const computedTotalCents = data.giving.reduce(
		(acc, donation) => acc + toCents(donation.amount),
		0,
	);
	const expectedTotalCents = toCents(data.total);

	return {
		computedCount,
		computedTotalCents,
		expectedCount: data.numberOfGiving,
		expectedTotalCents,
		isConsistent:
			computedCount === data.numberOfGiving && computedTotalCents === expectedTotalCents,
	};
};

const getDbSummaryConsistency = (
	summary: { totalAmount: string; numberOfDonations: number },
	donationRecords: { amount: string }[],
) => {
	const computedCount = donationRecords.length;
	const computedTotalCents = donationRecords.reduce(
		(acc, donation) => acc + toCents(donation.amount),
		0,
	);
	const expectedTotalCents = toCents(summary.totalAmount);

	return {
		computedCount,
		computedTotalCents,
		expectedCount: summary.numberOfDonations,
		expectedTotalCents,
		isConsistent:
			computedCount === summary.numberOfDonations && computedTotalCents === expectedTotalCents,
	};
};

// Helper to map donation record to UserGiving format
const mapDonationToGiving = (d: {
	amount: string;
	date: string;
	name: string;
	ccbTransactionId: string;
	taxDeductible: boolean;
	paymentType: string | null;
	campus: string | null;
	campusId: string | null;
}): UserGiving["giving"][number] => {
	const base: UserGiving["giving"][number] = {
		amount: Number(d.amount),
		date: d.date,
		name: d.name,
		transactionId: d.ccbTransactionId,
		taxDeductible: d.taxDeductible,
		campus: d.campus ?? "",
		campusId: d.campusId ?? "",
	};

	if (d.paymentType) {
		return { ...base, paymentType: d.paymentType };
	}

	return base;
};

// ═══════════════════════════════════════════════════════════════
// LAYER 1: LRU CACHE
// ═══════════════════════════════════════════════════════════════

const checkLruCache = (identity: DonationCacheIdentity) =>
	Effect.gen(function* () {
		const { year } = identity;
		const lru = yield* LRUService;
		const key = getCacheKey(identity);
		const cached = yield* lru.get<DonationCacheResult & { cachedAt: string }>(key);
		const cacheLogMetadata = getCacheLogMetadata(key);
		if (!cached) {
			yield* Effect.logDebug("LRU cache miss").pipe(
				Effect.annotateLogs({ layer: "lru-cache", ...cacheLogMetadata }),
			);
			return null;
		}
		yield* Effect.logDebug("LRU cache hit").pipe(
			Effect.annotateLogs({ layer: "lru-cache", year, ...cacheLogMetadata }),
		);

		const parsedConsistencyPayload = parseCacheConsistencyPayload(cached);
		if (Result.isFailure(parsedConsistencyPayload)) {
			yield* Effect.logWarning("Invalid LRU donations cache shape").pipe(
				Effect.annotateLogs({
					layer: "lru-cache",
					year,
					error: String(parsedConsistencyPayload.failure),
					...cacheLogMetadata,
				}),
			);
			yield* lru.delete(key).pipe(Effect.catch(() => Effect.succeed(false)));
			return null;
		}

		const consistency = getResultConsistency(parsedConsistencyPayload.success);
		if (!consistency.isConsistent) {
			yield* Effect.logWarning("Invalid LRU donations cache payload").pipe(
				Effect.annotateLogs({
					layer: "lru-cache",
					year,
					...consistency,
					...cacheLogMetadata,
				}),
			);
			yield* lru.delete(key).pipe(Effect.catch(() => Effect.succeed(false)));
			return null;
		}

		return {
			...cached,
			cachedAt: new Date(cached.cachedAt),
			source: "lru-cache" as const,
		};
	}).pipe(Effect.withSpan("DonationsV2.checkLruCache"));

const setLruCache = (identity: DonationCacheIdentity, data: DonationCacheResult) =>
	Effect.gen(function* () {
		const { year } = identity;
		const lru = yield* LRUService;
		const key = getCacheKey(identity);
		const now = DateTime.toEpochMillis(yield* DateTime.now);
		yield* lru.set(key, data, Duration.toMillis(untilNextGivingRefresh(now)));
		const cacheLogMetadata = getCacheLogMetadata(key);
		yield* Effect.logDebug("LRU cache set").pipe(
			Effect.annotateLogs({ layer: "lru-cache", year, ...cacheLogMetadata }),
		);
	}).pipe(Effect.catch(() => Effect.void));

// ═══════════════════════════════════════════════════════════════
// LAYER 2: REDIS CACHE
// ═══════════════════════════════════════════════════════════════

const checkRedis = (identity: DonationCacheIdentity) =>
	Effect.gen(function* () {
		const { year } = identity;
		const redis = yield* RedisService;
		const key = getCacheKey(identity);
		const cacheLogMetadata = getCacheLogMetadata(key);

		const cached = yield* redis
			.get(key)
			.pipe(Effect.catchTag("RedisError", () => Effect.succeed(null)));

		if (!cached) {
			yield* Effect.logDebug("Redis cache miss").pipe(
				Effect.annotateLogs({ layer: "redis", ...cacheLogMetadata }),
			);
			return null;
		}

		const parsedRedisPayload = parseRedisDonationCachePayload(cached);
		if (Result.isFailure(parsedRedisPayload)) {
			yield* redis.del(key).pipe(Effect.catch(() => Effect.void));
			yield* Effect.logWarning("Invalid Redis donations cache value").pipe(
				Effect.annotateLogs({
					layer: "redis",
					error: String(parsedRedisPayload.failure),
					cachedSize: cached.length,
					...cacheLogMetadata,
				}),
			);
			return null;
		}

		const data = toDonationCacheResultFromRedis(parsedRedisPayload.success);

		yield* Effect.logDebug("Redis cache hit").pipe(
			Effect.annotateLogs({ layer: "redis", year, ...cacheLogMetadata }),
		);

		const parsedConsistencyPayload = parseCacheConsistencyPayload(data);
		if (Result.isFailure(parsedConsistencyPayload)) {
			yield* Effect.logWarning("Invalid Redis donations cache shape").pipe(
				Effect.annotateLogs({
					layer: "redis",
					year,
					error: String(parsedConsistencyPayload.failure),
					...cacheLogMetadata,
				}),
			);
			yield* redis.del(key).pipe(Effect.catch(() => Effect.void));
			return null;
		}

		const consistency = getResultConsistency(parsedConsistencyPayload.success);
		if (!consistency.isConsistent) {
			yield* Effect.logWarning("Invalid Redis donations cache payload").pipe(
				Effect.annotateLogs({
					layer: "redis",
					year,
					...consistency,
					...cacheLogMetadata,
				}),
			);
			yield* redis.del(key).pipe(Effect.catch(() => Effect.void));
			return null;
		}

		return {
			...data,
			cachedAt: new Date(data.cachedAt),
			source: "redis" as const,
		};
	}).pipe(Effect.withSpan("DonationsV2.checkRedis"));

// ═══════════════════════════════════════════════════════════════
// LAYER 3: POSTGRESQL CACHE
// ═══════════════════════════════════════════════════════════════

const checkDb = (identity: DonationCacheIdentity) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		const { userId, year, ccbId } = identity;
		const [summary] = yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(donationYearlySummaries)
					.where(
						and(eq(donationYearlySummaries.userId, userId), eq(donationYearlySummaries.year, year)),
					)
					.limit(1),
			catch: (error) =>
				new DonationCacheError({
					cause: error,
					message: `DB summary query failed: ${String(error)}`,
				}),
		});

		// Rows cached for another CCB individual (before a relink, or before ccb_id was recorded)
		// are not this member's giving.
		if (!summary || summary.ccbId !== ccbId || summary.isStale || isDbStale(summary.lastSyncedAt)) {
			yield* Effect.logDebug("DB cache miss or stale/invalidated").pipe(
				Effect.annotateLogs({
					layer: "db",
					year,
					hasEntry: Boolean(summary),
					isCcbIdMismatch: summary ? summary.ccbId !== ccbId : "N/A",
					isTtlStale: summary ? isDbStale(summary.lastSyncedAt) : "N/A",
					isFlaggedStale: summary?.isStale ?? "N/A",
				}),
			);
			return null;
		}

		// Fetch full donation records
		const donationRecords = yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(donations)
					.where(and(eq(donations.userId, userId), eq(donations.year, year)))
					.orderBy(desc(donations.date)),
			catch: (error) =>
				new DonationCacheError({
					cause: error,
					message: `DB donations query failed: ${String(error)}`,
				}),
		});

		yield* Effect.logDebug("DB cache hit").pipe(
			Effect.annotateLogs({
				layer: "db",
				year,
				donationCount: donationRecords.length,
			}),
		);

		const consistency = getDbSummaryConsistency(summary, donationRecords);
		if (!consistency.isConsistent) {
			yield* Effect.logWarning("DB donation summary mismatch detected, forcing CCB refetch").pipe(
				Effect.annotateLogs({
					layer: "db",
					year,
					...consistency,
				}),
			);

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(donationYearlySummaries)
						.set({ isStale: true })
						.where(
							and(
								eq(donationYearlySummaries.userId, userId),
								eq(donationYearlySummaries.year, year),
							),
						),
				catch: (error) =>
					new DonationCacheError({
						cause: error,
						message: `Failed to mark mismatched DB cache stale: ${String(error)}`,
					}),
			}).pipe(
				Effect.catch((error) =>
					Effect.logError("Failed to mark DB cache as stale").pipe(
						Effect.annotateLogs({
							layer: "db",
							year,
							error: String(error),
						}),
						Effect.asVoid,
					),
				),
			);

			return null;
		}

		const result: DonationCacheResult = {
			giving: donationRecords.map((d) => mapDonationToGiving(d)),
			total: Number(summary.totalAmount),
			numberOfGiving: summary.numberOfDonations,
			ccbId,
			year,
			source: "db",
			cachedAt: summary.lastSyncedAt,
		};

		return result;
	}).pipe(Effect.withSpan("DonationsV2.checkDb"));

// ═══════════════════════════════════════════════════════════════
// LAYER 4: CCB API + PERSIST
// ═══════════════════════════════════════════════════════════════

type FetchAndPersistParams = DonationCacheIdentity;

const fetchAndPersist = (params: FetchAndPersistParams) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		const { userId, ccbFamilyId, ccbId, year } = params;
		const ccb = yield* CCBService;
		const redis = yield* RedisService;
		const startTime = DateTime.toEpochMillis(yield* DateTime.now);

		yield* Effect.logInfo("Fetching from CCB API").pipe(
			Effect.annotateLogs({ layer: "ccb", year }),
		);

		// Skip CCBService's own response cache: a response cached before the weekly refresh would be stored
		// here as current until the next one.
		const rawGiving = yield* ccb.getGiving(ccbFamilyId, year, { skipCache: true });
		const parsed = yield* Effect.try({
			try: () => parseGiving(rawGiving, ccbId, year),
			catch: (cause) =>
				new DonationCacheError({ message: "Invalid giving data received from CCB", cause }),
		});
		const donationRows = parsed.giving.map((donation) => ({
			userId,
			ccbTransactionId: donation.transactionId,
			amount: String(donation.amount),
			date: donation.date,
			year,
			name: donation.name,
			campus: donation.campus || null,
			campusId: donation.campusId || null,
			paymentType: donation.paymentType ?? null,
			taxDeductible: donation.taxDeductible,
		}));
		const dedupedDonationRows = [
			...donationRows
				.reduce((acc, row) => {
					// Keep the first instance for a transaction id to avoid
					// duplicate conflict targets in a single INSERT batch.
					if (!acc.has(row.ccbTransactionId)) {
						acc.set(row.ccbTransactionId, row);
					}
					return acc;
				}, new Map<string, (typeof donationRows)[number]>())
				.values(),
		];
		const persistedCount = dedupedDonationRows.length;
		const persistedTotalCents = dedupedDonationRows.reduce(
			(acc, row) => acc + toCents(row.amount),
			0,
		);
		const persistedTotal = (persistedTotalCents / 100).toFixed(2);

		const result: DonationCacheResult = {
			giving: dedupedDonationRows.map((row) => mapDonationToGiving(row)),
			total: Number(persistedTotal),
			numberOfGiving: persistedCount,
			ccbId,
			year,
			source: "ccb",
			cachedAt: new Date(),
		};

		// Persist in the service scope so returning the response does not cancel the write.
		yield* Effect.forkScoped(
			Effect.gen(function* () {
				yield* Effect.tryPromise({
					try: () =>
						db.transaction(async (tx) => {
							// The year's rows become exactly what CCB returned: drop the ones it no longer
							// returns (or that belonged to another CCB individual) before upserting the rest.
							const fetchedTransactionIds = dedupedDonationRows.map((row) => row.ccbTransactionId);
							await tx
								.delete(donations)
								.where(
									and(
										eq(donations.userId, userId),
										eq(donations.year, year),
										fetchedTransactionIds.length > 0
											? notInArray(donations.ccbTransactionId, fetchedTransactionIds)
											: undefined,
									),
								);

							// Batch upserts to reduce round trips and transaction time.
							for (
								let offset = 0;
								offset < dedupedDonationRows.length;
								offset += DONATION_UPSERT_CHUNK_SIZE
							) {
								const batch = dedupedDonationRows.slice(
									offset,
									offset + DONATION_UPSERT_CHUNK_SIZE,
								);

								// oxlint-disable-next-line no-await-in-loop
								await tx
									.insert(donations)
									.values(batch)
									.onConflictDoUpdate({
										target: [donations.userId, donations.ccbTransactionId],
										set: {
											amount: sql`excluded.amount`,
											date: sql`excluded.date`,
											year: sql`excluded.year`,
											name: sql`excluded.name`,
											campus: sql`excluded.campus`,
											campusId: sql`excluded.campus_id`,
											paymentType: sql`excluded.payment_type`,
											taxDeductible: sql`excluded.tax_deductible`,
											syncedFromCcbAt: new Date(),
										},
									});
							}

							// Upsert summary
							await tx
								.insert(donationYearlySummaries)
								.values({
									userId,
									year,
									ccbId,
									totalAmount: persistedTotal,
									numberOfDonations: persistedCount,
									lastSyncedAt: new Date(),
									isStale: false,
								})
								.onConflictDoUpdate({
									target: [donationYearlySummaries.userId, donationYearlySummaries.year],
									set: {
										ccbId,
										totalAmount: persistedTotal,
										numberOfDonations: persistedCount,
										lastSyncedAt: new Date(),
										isStale: false,
									},
								});

							// Log sync
							await tx.insert(donationSyncLogs).values({
								userId,
								year,
								transactionCount: persistedCount,
								totalAmount: persistedTotal,
								syncStatus: "SUCCESS",
								durationMs: DateTime.toEpochMillis(DateTime.nowUnsafe()) - startTime,
							});
						}),
					catch: (error) =>
						new DonationCacheError({
							cause: error,
							message: `DB persist failed: ${String(error)}`,
						}),
				});

				yield* Effect.logDebug("Persisted to DB").pipe(
					Effect.annotateLogs({
						layer: "db",
						year,
						donationCount: persistedCount,
					}),
				);
			}).pipe(
				Effect.timeout(BACKGROUND_CACHE_TIMEOUT),
				Effect.catch((error) =>
					Effect.logError("Failed to persist giving cache to DB").pipe(
						Effect.annotateLogs({
							layer: "db",
							year,
							donationCount: persistedCount,
							error: formatUnknownError(error),
						}),
						Effect.asVoid,
					),
				),
			),
		);

		// Cache to Redis (fire and forget)
		const ttlSeconds = getRedisTtlSeconds(DateTime.toEpochMillis(yield* DateTime.now));
		const cacheKey = getCacheKey(params);
		const cacheLogMetadata = getCacheLogMetadata(cacheKey);
		yield* Effect.forkScoped(
			redis.setex(cacheKey, ttlSeconds, JSON.stringify(result)).pipe(
				Effect.timeout(BACKGROUND_CACHE_TIMEOUT),
				Effect.tap(() =>
					Effect.logDebug("Cached to Redis").pipe(
						Effect.annotateLogs({ layer: "redis", year, ttlSeconds }),
					),
				),
				Effect.catch((error) =>
					Effect.logError("Failed to cache giving result to Redis").pipe(
						Effect.annotateLogs({
							layer: "redis",
							year,
							ttlSeconds,
							error: formatUnknownError(error),
							...cacheLogMetadata,
						}),
						Effect.asVoid,
					),
				),
			),
		);

		yield* Effect.logInfo("CCB fetch complete").pipe(
			Effect.annotateLogs({
				layer: "ccb",
				year,
				donationCount: result.giving.length,
				total: result.total,
				durationMs: DateTime.toEpochMillis(yield* DateTime.now) - startTime,
			}),
		);

		return result;
	}).pipe(Effect.withSpan("DonationsV2.fetchAndPersist"));

// ═══════════════════════════════════════════════════════════════
// MAIN: 3-TIER LOOKUP
// ═══════════════════════════════════════════════════════════════

interface GetYearlyDonationsParams {
	userId: string;
	ccbFamilyId: string;
	ccbId: string;
	year: number;
}

const getYearlyDonations = (params: GetYearlyDonationsParams) =>
	Effect.gen(function* () {
		const { userId, ccbFamilyId, ccbId, year } = params;
		const redis = yield* RedisService;
		// Layer 1: LRU Cache
		const lruResult = yield* checkLruCache(params);
		if (lruResult) {
			return { ...lruResult, ccbId };
		}

		// Layer 2: Redis
		const redisResult = yield* checkRedis(params);
		if (redisResult) {
			// Warm up LRU cache
			yield* setLruCache(params, redisResult);
			return { ...redisResult, ccbId };
		}

		// Layer 3: PostgreSQL
		const dbResult = yield* checkDb(params);
		if (dbResult) {
			// Warm up LRU cache
			yield* setLruCache(params, dbResult);
			// Warm up Redis cache in background
			const ttlSeconds = getRedisTtlSeconds(DateTime.toEpochMillis(yield* DateTime.now));
			yield* Effect.forkScoped(
				redis.setex(getCacheKey(params), ttlSeconds, JSON.stringify(dbResult)).pipe(
					Effect.timeout(BACKGROUND_CACHE_TIMEOUT),
					Effect.tap(() =>
						Effect.logDebug("Warmed Redis from DB").pipe(
							Effect.annotateLogs({ layer: "redis", year }),
						),
					),
					Effect.catch(() => Effect.void),
				),
			);
			return { ...dbResult, ccbId };
		}

		// Layer 4: CCB API
		const ccbResult = yield* fetchAndPersist({
			userId,
			ccbFamilyId,
			ccbId,
			year,
		});
		// Warm up LRU cache
		yield* setLruCache(params, ccbResult);
		return ccbResult;
	}).pipe(Effect.withSpan("DonationsV2.getYearlyDonations"));

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

interface GetPreviousFiveYearsParams {
	userId: string;
	ccbFamilyId: string;
	ccbId: string;
}

/**
 * Get donations for the previous 5 years, reading each year from the first layer that has it:
 * 1. In-process LRU, then Redis
 * 2. PostgreSQL
 * 3. CCB API (source of truth)
 * Every layer keeps a year until the next weekly refresh (see giving/weeklyRefresh).
 */
const getPreviousFiveYearsGivingV2 = (params: GetPreviousFiveYearsParams) =>
	Effect.gen(function* () {
		const { userId, ccbFamilyId, ccbId } = params;
		const currentYear = new Date().getFullYear();
		const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

		yield* Effect.logInfo("Starting getPreviousFiveYearsGivingV2").pipe(
			Effect.annotateLogs({ yearCount: years.length }),
		);

		const results = yield* Effect.forEach(
			years,
			(year) => getYearlyDonations({ userId, ccbFamilyId, ccbId, year }),
			{ concurrency: 5 },
		);

		yield* Effect.logInfo("Completed getPreviousFiveYearsGivingV2").pipe(
			Effect.annotateLogs({ yearCount: years.length }),
		);

		return results;
	}).pipe(Effect.withSpan("GraphQL.getPreviousFiveYearsGivingV2"));

interface GivingServiceContract {
	getPreviousFiveYears: (
		params: GetPreviousFiveYearsParams,
	) => Effect.Effect<
		DonationCacheResult[],
		unknown,
		CCBService | DrizzleService | LRUService | RedisService
	>;
}

export class GivingService extends Context.Service<GivingService, GivingServiceContract>()(
	"GivingService",
	{
		make: Effect.gen(function* () {
			const scope = yield* Effect.scope;
			return {
				getPreviousFiveYears: (params) =>
					getPreviousFiveYearsGivingV2(params).pipe(Effect.provideService(Scope.Scope, scope)),
			} satisfies GivingServiceContract;
		}),
	},
) {
	static readonly layer = Layer.effect(GivingService, GivingService.make);
}

export const GivingServiceLive = GivingService.layer;
