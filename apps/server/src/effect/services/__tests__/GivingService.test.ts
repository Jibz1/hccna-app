import { donations, donationSyncLogs, donationYearlySummaries } from "@/db/schema/donations";
import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { CCBService } from "@/effect/services/CCBService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { GivingService, GivingServiceLive } from "@/effect/services/GivingService";
import { describe, expect, it, mock } from "bun:test";
import { asc, count } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";

import { useGivingTestDb } from "./givingTestDb";

const donationResult = {
	giving: [],
	total: 0,
	numberOfGiving: 0,
	ccbId: "individual-1",
	year: new Date().getFullYear(),
	source: "lru-cache",
	cachedAt: new Date().toISOString(),
};

const makeRedisLayer = (
	overrides: Partial<Record<"get" | "setex" | "del", (...args: never[]) => unknown>> = {},
) =>
	Layer.succeed(RedisService, {
		get: () => Effect.succeed(null),
		mget: () => Effect.succeed([]),
		set: () => Effect.void,
		setex: () => Effect.void,
		incr: () => Effect.succeed(1),
		decr: () => Effect.succeed(0),
		ttl: () => Effect.succeed(0),
		expire: () => Effect.void,
		del: () => Effect.void,
		keys: () => Effect.succeed([]),
		ping: () => Effect.void,
		...overrides,
	} as never);

describe("GivingService", () => {
	it("returns previous five years from the hot cache without Redis or CCB access", async () => {
		const getGiving = mock(() => Effect.succeed(""));
		const lruGet = mock(() => Effect.succeed(donationResult));
		const lruDelete = mock(() => Effect.succeed(true));
		const redisDel = mock(() => Effect.void);
		const redisGet = mock(() => Effect.succeed(null));

		const lruLayer = Layer.succeed(LRUService, {
			get: lruGet,
			set: () => Effect.void,
			delete: lruDelete,
		} as never);
		const redisLayer = makeRedisLayer({ get: redisGet, del: redisDel });
		const ccbLayer = Layer.succeed(CCBService, { getGiving } as never);
		const drizzleLayer = Layer.succeed(DrizzleService, { db: {} } as never);
		const dependencyLayer = Layer.mergeAll(lruLayer, redisLayer, ccbLayer, drizzleLayer);
		const TestLayer = GivingServiceLive.pipe(Layer.provideMerge(dependencyLayer));

		const program = Effect.gen(function* () {
			const giving = yield* GivingService;
			return yield* giving.getPreviousFiveYears({
				userId: "user-1",
				ccbFamilyId: "family-1",
				ccbId: "individual-1",
			});
		});

		const result = await Effect.runPromise(Effect.provide(program, TestLayer));

		expect(result).toHaveLength(5);
		expect(lruGet).toHaveBeenCalledTimes(5);
		const currentYear = new Date().getFullYear();
		for (const i of Array.from({ length: 5 }, (_, index) => index)) {
			expect(lruGet).toHaveBeenNthCalledWith(
				i + 1,
				`donations-v3:user-1:family-1:individual-1:${currentYear - i}`,
			);
		}
		expect(lruDelete).not.toHaveBeenCalled();
		expect(redisDel).not.toHaveBeenCalled();
		expect(redisGet).not.toHaveBeenCalled();
		expect(getGiving).not.toHaveBeenCalled();
	});
});

const YEAR = new Date().getFullYear();
const FAMILY_ID = "1001";
const CCB_ID = "2001";
const PREVIOUS_CCB_ID = "2002";

interface CcbGift {
	id: string;
	date: string;
	amount: number;
}

/** A transactions_by_family answer with every gift made by CCB_ID. */
const ccbAnswer = (gifts: CcbGift[]) => ({
	transactions: {
		transaction: gifts.map((gift) => ({
			individual: { id: CCB_ID },
			date: gift.date,
			transaction_details: {
				transaction_detail: { id: gift.id, amount: gift.amount, coa: { text: "General Fund" } },
			},
		})),
	},
});

/** A stored donation row for user-a, filed under its gift date's year. */
const donationRow = (id: string, date: string, amount: string) => ({
	userId: "user-a",
	ccbTransactionId: id,
	amount,
	date,
	year: Number(date.slice(0, 4)),
	name: "General Fund",
});

/** A summary for user-a that is fresh and agrees with one stored row of `totalAmount`. */
const freshSummary = (year: number, ccbId: string | null, totalAmount: string) => ({
	userId: "user-a",
	year,
	ccbId,
	totalAmount,
	numberOfDonations: 1,
	lastSyncedAt: new Date(),
	isStale: false,
});

describe("GivingService database cache", () => {
	const getDatabase = useGivingTestDb();

	/** Runs getPreviousFiveYears for user-a and waits for the background writes to land. */
	const fetchFiveYears = async (answers: Map<number, CcbGift[]>) => {
		const { db } = getDatabase();
		const getGiving = mock((_familyId: string, year: number) =>
			Effect.succeed(ccbAnswer(answers.get(year) ?? [])),
		);
		const setex = mock((_key: string, _seconds: number, _value: string) => Effect.void);
		const dependencies = Layer.mergeAll(
			Layer.succeed(LRUService, {
				get: () => Effect.void,
				set: () => Effect.void,
				delete: () => Effect.succeed(false),
			} as never),
			makeRedisLayer({ setex }),
			Layer.succeed(CCBService, { getGiving } as never),
			Layer.succeed(DrizzleService, { db } as never),
		);
		// The service persists in its own scope, so keep the runtime open until the writes finish.
		const runtime = ManagedRuntime.make(GivingServiceLive.pipe(Layer.provideMerge(dependencies)));
		try {
			const years = await runtime.runPromise(
				Effect.gen(function* () {
					const giving = yield* GivingService;
					return yield* giving.getPreviousFiveYears({
						userId: "user-a",
						ccbFamilyId: FAMILY_ID,
						ccbId: CCB_ID,
					});
				}),
			);
			const fetchedYears = getGiving.mock.calls.length;
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				// oxlint-disable-next-line no-await-in-loop
				const [logs] = await db.select({ value: count() }).from(donationSyncLogs);
				if (logs?.value === fetchedYears) {
					break;
				}
				// oxlint-disable-next-line no-await-in-loop
				await Bun.sleep(10);
			}
			// The five years are looked up concurrently, so CCB sees them in no fixed order.
			const fetchedYearList = getGiving.mock.calls
				.map(([, year]) => year)
				.toSorted((a, b) => b - a);
			const redisKeys = setex.mock.calls.map(([key]) => key);
			return { years, fetchedYearList, redisKeys };
		} finally {
			await runtime.dispose();
		}
	};

	const storedDonations = () =>
		getDatabase()
			.db.select({
				userId: donations.userId,
				id: donations.ccbTransactionId,
				year: donations.year,
				amount: donations.amount,
			})
			.from(donations)
			.orderBy(asc(donations.userId), asc(donations.year), asc(donations.ccbTransactionId));

	const storedSummaries = () =>
		getDatabase()
			.db.select({
				year: donationYearlySummaries.year,
				ccbId: donationYearlySummaries.ccbId,
				totalAmount: donationYearlySummaries.totalAmount,
				numberOfDonations: donationYearlySummaries.numberOfDonations,
			})
			.from(donationYearlySummaries)
			.orderBy(asc(donationYearlySummaries.year));

	it("replaces each fetched year's rows with CCB's answer and records the CCB id", async () => {
		const { db } = getDatabase();
		await db
			.insert(donations)
			.values([
				donationRow("removed-in-ccb", `${YEAR}-01-05`, "5.00"),
				donationRow("amended-gift", `${YEAR}-02-01`, "10.00"),
				donationRow("prior-year-gift", `${YEAR - 1}-12-20`, "30.00"),
				donationRow("emptied-year-gift", `${YEAR - 2}-06-01`, "7.00"),
				{ ...donationRow("other-member-gift", `${YEAR}-01-05`, "50.00"), userId: "user-b" },
			]);
		// Last year is a fresh cache hit, so it is not refetched.
		await db.insert(donationYearlySummaries).values(freshSummary(YEAR - 1, CCB_ID, "30.00"));

		const { years, fetchedYearList, redisKeys } = await fetchFiveYears(
			new Map([
				[
					YEAR,
					[
						{ id: "amended-gift", date: `${YEAR}-02-01`, amount: 15 },
						{ id: "new-gift", date: `${YEAR}-03-01`, amount: 20 },
						// Edited this year, so CCB's modification window returns it with this year's answer.
						{ id: "prior-year-gift", date: `${YEAR - 1}-12-20`, amount: 30 },
					],
				],
			]),
		);

		expect(fetchedYearList).toEqual([YEAR, YEAR - 2, YEAR - 3, YEAR - 4]);
		const thisYear = years.find((year) => year.year === YEAR);
		expect(thisYear?.giving.map((gift) => gift.transactionId)).toEqual([
			"new-gift",
			"amended-gift",
		]);
		expect(thisYear).toMatchObject({ total: 35, numberOfGiving: 2, source: "ccb" });
		expect(await storedDonations()).toEqual([
			{ userId: "user-a", id: "prior-year-gift", year: YEAR - 1, amount: "30.00" },
			{ userId: "user-a", id: "amended-gift", year: YEAR, amount: "15.00" },
			{ userId: "user-a", id: "new-gift", year: YEAR, amount: "20.00" },
			{ userId: "user-b", id: "other-member-gift", year: YEAR, amount: "50.00" },
		]);
		expect(await storedSummaries()).toEqual([
			{ year: YEAR - 4, ccbId: CCB_ID, totalAmount: "0.00", numberOfDonations: 0 },
			{ year: YEAR - 3, ccbId: CCB_ID, totalAmount: "0.00", numberOfDonations: 0 },
			{ year: YEAR - 2, ccbId: CCB_ID, totalAmount: "0.00", numberOfDonations: 0 },
			{ year: YEAR - 1, ccbId: CCB_ID, totalAmount: "30.00", numberOfDonations: 1 },
			{ year: YEAR, ccbId: CCB_ID, totalAmount: "35.00", numberOfDonations: 2 },
		]);
		expect(redisKeys).toContain(`donations-v3:user-a:${FAMILY_ID}:${CCB_ID}:${YEAR}`);
		expect(redisKeys.every((key) => key.startsWith("donations-v3:"))).toBe(true);
	});

	it.each([null, PREVIOUS_CCB_ID])(
		"refetches from CCB when the summary's CCB id is %p",
		async (summaryCcbId) => {
			const { db } = getDatabase();
			const fiveYears = Array.from({ length: 5 }, (_, index) => YEAR - index);
			await db
				.insert(donations)
				.values(
					fiveYears.map((year) =>
						donationRow(`previous-account-${year}`, `${year}-04-01`, "12.00"),
					),
				);
			await db
				.insert(donationYearlySummaries)
				.values(fiveYears.map((year) => freshSummary(year, summaryCcbId, "12.00")));

			const { years, fetchedYearList } = await fetchFiveYears(
				new Map([[YEAR, [{ id: "relinked-gift", date: `${YEAR}-05-01`, amount: 25 }]]]),
			);

			expect(fetchedYearList).toEqual(fiveYears);
			expect(years.every((year) => year.source === "ccb")).toBe(true);
			expect(await storedDonations()).toEqual([
				{ userId: "user-a", id: "relinked-gift", year: YEAR, amount: "25.00" },
			]);
			const summaries = await storedSummaries();
			expect(summaries.map((summary) => summary.ccbId)).toEqual(fiveYears.map(() => CCB_ID));
		},
	);

	it("serves a fresh summary for the same CCB id from the database", async () => {
		const { db } = getDatabase();
		const fiveYears = Array.from({ length: 5 }, (_, index) => YEAR - index);
		await db
			.insert(donations)
			.values(fiveYears.map((year) => donationRow(`gift-${year}`, `${year}-04-01`, "12.00")));
		await db
			.insert(donationYearlySummaries)
			.values(fiveYears.map((year) => freshSummary(year, CCB_ID, "12.00")));

		const { years, fetchedYearList } = await fetchFiveYears(new Map());

		expect(fetchedYearList).toEqual([]);
		expect(years.map((year) => [year.source, year.total])).toEqual(fiveYears.map(() => ["db", 12]));
	});
});
