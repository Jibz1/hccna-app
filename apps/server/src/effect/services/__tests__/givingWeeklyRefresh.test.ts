import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { CCBService } from "@/effect/services/CCBService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { lastGivingRefresh, untilNextGivingRefresh } from "@/effect/services/giving/weeklyRefresh";
import {
	GivingService,
	GivingServiceLive,
	type DonationCacheResult,
} from "@/effect/services/GivingService";
import { describe, expect, it, mock } from "bun:test";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

const at = (iso: string) => Date.parse(iso);

const currentYear = new Date().getFullYear();

const emptySummary = {
	userId: "user-1",
	year: currentYear,
	ccbId: "individual-1",
	totalAmount: "0.00",
	numberOfDonations: 0,
	lastSyncedAt: new Date(),
	isStale: false,
};

// Answers checkDb's summary lookup and donations query, and accepts fetchAndPersist's write.
const summaryDb = (summary?: typeof emptySummary) => ({
	select: () => ({
		from: () => ({
			where: () => ({
				limit: () => Promise.resolve(summary ? [summary] : []),
				orderBy: () => Promise.resolve([]),
			}),
		}),
	}),
	transaction: () => Promise.resolve(),
});

const makeLayer = (deps: {
	readonly lru?: object;
	readonly redis?: object;
	readonly getGiving: unknown;
	readonly db: unknown;
}) => {
	const lruLayer = Layer.succeed(LRUService, {
		get: () => Effect.void,
		set: () => Effect.void,
		delete: () => Effect.succeed(true),
		...deps.lru,
	} as never);
	const redisLayer = Layer.succeed(RedisService, {
		get: () => Effect.succeed(null),
		setex: () => Effect.void,
		del: () => Effect.void,
		...deps.redis,
	} as never);
	const ccbLayer = Layer.succeed(CCBService, { getGiving: deps.getGiving } as never);
	const drizzleLayer = Layer.succeed(DrizzleService, { db: deps.db } as never);
	const dependencyLayer = Layer.mergeAll(lruLayer, redisLayer, ccbLayer, drizzleLayer);
	return GivingServiceLive.pipe(Layer.provideMerge(dependencyLayer));
};

const previousFiveYears = Effect.gen(function* () {
	const giving = yield* GivingService;
	return yield* giving.getPreviousFiveYears({
		userId: "user-1",
		ccbFamilyId: "family-1",
		ccbId: "individual-1",
	});
});

/** How many years CCB is asked for when every DB summary was synced at `lastSyncedAt`. */
const ccbReadsAfterDbSync = async (lastSyncedAt: number) => {
	const getGiving = mock(() => Effect.succeed({}));
	const db = summaryDb({ ...emptySummary, lastSyncedAt: new Date(lastSyncedAt) });
	await Effect.runPromise(Effect.provide(previousFiveYears, makeLayer({ getGiving, db })));
	return getGiving.mock.calls.length;
};

describe("weekly giving refresh", () => {
	it("keeps giving read on Sunday night until Monday morning", () => {
		// 11pm EDT on Sunday, before the week's import is assumed to have landed.
		const sundayNight = at("2026-10-19T03:00:00Z");

		expect(lastGivingRefresh(sundayNight)).toBe(at("2026-10-12T10:00:00Z"));
		expect(Duration.toHours(untilNextGivingRefresh(sundayNight))).toBe(7);
	});

	it("starts a new week at Monday 10:00 UTC", () => {
		const refresh = at("2026-10-19T10:00:00Z");

		expect(lastGivingRefresh(refresh - 1)).toBe(at("2026-10-12T10:00:00Z"));
		expect(lastGivingRefresh(refresh)).toBe(refresh);
		expect(untilNextGivingRefresh(refresh)).toEqual(Duration.weeks(1));
	});

	it("keeps giving read midweek until the next Monday", () => {
		const wednesday = at("2026-12-16T15:30:00Z");

		expect(lastGivingRefresh(wednesday)).toBe(at("2026-12-14T10:00:00Z"));
		expect(wednesday + Duration.toMillis(untilNextGivingRefresh(wednesday))).toBe(
			at("2026-12-21T10:00:00Z"),
		);
	});
});

describe("GivingService weekly refresh", () => {
	it("caches a year read from CCB until the next weekly refresh", async () => {
		const getGiving = mock(
			(_familyId: string, _year: number, _options: { readonly skipCache?: boolean }) =>
				Effect.succeed({}),
		);
		const lruSet = mock(
			(_key: string, _value: DonationCacheResult, _ttlMs?: number) => Effect.void,
		);
		const setex = mock((_key: string, _seconds: number, _value: string) => Effect.void);
		const TestLayer = Layer.merge(
			makeLayer({ lru: { set: lruSet }, redis: { setex }, getGiving, db: summaryDb() }),
			TestClock.layer(),
		);
		// Wednesday noon UTC: the next refresh, Monday 10:00 UTC, is 4 days 22 hours away.
		const program = TestClock.setTime(at("2026-10-14T12:00:00Z")).pipe(
			Effect.andThen(previousFiveYears),
		);
		const ttlSeconds = (4 * 24 + 22) * 60 * 60;

		await Effect.runPromise(Effect.provide(program, TestLayer));

		expect(getGiving).toHaveBeenCalledTimes(5);
		expect(getGiving).toHaveBeenCalledWith("family-1", currentYear, { skipCache: true });
		expect(setex.mock.calls.map(([, seconds]) => seconds)).toEqual(
			Array.from({ length: 5 }, () => ttlSeconds),
		);
		expect(lruSet.mock.calls.map((call) => call[2])).toEqual(
			Array.from({ length: 5 }, () => ttlSeconds * 1000),
		);
	});

	it("re-reads CCB for a DB copy synced before the latest weekly refresh", async () => {
		const refresh = lastGivingRefresh(Date.now());

		expect(await ccbReadsAfterDbSync(refresh)).toBe(0);
		expect(await ccbReadsAfterDbSync(refresh - 1)).toBe(5);
	});
});
