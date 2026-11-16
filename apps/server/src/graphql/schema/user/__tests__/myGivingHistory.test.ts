import { DrizzleService } from "@/effect/services/DrizzleService";
import { GivingService } from "@/effect/services/GivingService";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { createMockContext } from "@/graphql/__tests__/utils/test-context";
import { schema } from "@/graphql/schema";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { execute, parse } from "graphql";

const EMAIL = "ada@example.com";
const FAMILY_ID = "1001";
const CCB_ID = "2001";
const linkedUser = { id: "user-a", ccbId: CCB_ID, ccbFamilyId: FAMILY_ID };

const QUERY = parse(`query {
	myGivingHistory {
		__typename
		... on MyGivingHistorySuccess { years { year total } }
		... on MyGivingHistoryFetchError { message }
		... on MyGivingHistoryNotFoundError { message }
	}
}`);

/** Answers the resolver's user lookup (db.select().from().where().limit()). */
const usersTable = (lookup: () => Promise<unknown[]>) => ({
	db: { select: () => ({ from: () => ({ where: () => ({ limit: lookup }) }) }) },
});

const runQuery = async (
	lookup: () => Promise<unknown[]>,
	getPreviousFiveYears: () => Effect.Effect<unknown, unknown>,
) => {
	const logs = captureLogs();
	const provide = <A, E>(program: Effect.Effect<A, E, DrizzleService | GivingService>) =>
		program.pipe(
			Effect.provideService(DrizzleService, usersTable(lookup) as never),
			Effect.provideService(GivingService, { getPreviousFiveYears } as never),
			Effect.provide(logs.layer),
		);
	const contextValue = createMockContext({
		authorized: true,
		authType: "jwt",
		currentUserUid: "uid-a",
		currentUserEmail: EMAIL,
		effectRunPromise: (<A, E, R>(program: Effect.Effect<A, E, R>) =>
			Effect.runPromise(
				provide(program as Effect.Effect<A, E, DrizzleService | GivingService>),
			)) as never,
	});
	const result = await execute({ schema, document: QUERY, contextValue });
	expect(result.errors).toBeUndefined();
	return { data: result.data, logs: logs.lines };
};

const neverCalled = () => Effect.die("GivingService should not be called");

/** The client sees only the fixed message; the one error log has the cause but no identifiers. */
const expectMaskedFailure = async (
	lookup: () => Promise<unknown[]>,
	getPreviousFiveYears: () => Effect.Effect<unknown, unknown>,
	cause: string,
) => {
	const { data, logs } = await runQuery(lookup, getPreviousFiveYears);

	expect(data).toEqual({
		myGivingHistory: {
			__typename: "MyGivingHistoryFetchError",
			message: "Failed to fetch previous five years giving",
		},
	});
	expect(logs).toHaveLength(1);
	expect(logs[0]).toStartWith("Error ");
	expect(logs[0]).toContain('"operation":"myGivingHistory"');
	expect(logs[0]).toContain(cause);
	for (const identifier of [EMAIL, FAMILY_ID, CCB_ID]) {
		expect(logs[0]).not.toContain(identifier);
	}
};

describe("myGivingHistory", () => {
	it("returns the giving years", async () => {
		const { data } = await runQuery(
			() => Promise.resolve([linkedUser]),
			() =>
				Effect.succeed([{ year: 2026, total: 25, giving: [], numberOfGiving: 0, ccbId: CCB_ID }]),
		);

		expect(data).toEqual({
			myGivingHistory: { __typename: "MyGivingHistorySuccess", years: [{ year: 2026, total: 25 }] },
		});
	});

	it("answers a fixed message and logs the cause when the giving service fails", async () => {
		await expectMaskedFailure(
			() => Promise.resolve([linkedUser]),
			() => Effect.fail(new Error("DB summary query failed: connection refused")),
			"DB summary query failed: connection refused",
		);
	});

	it("answers a fixed message and logs the cause when the user lookup fails", async () => {
		await expectMaskedFailure(
			() => Promise.reject(new Error("app_users query failed: connection refused")),
			neverCalled,
			"app_users query failed: connection refused",
		);
	});

	it.each([
		["no user matches the session", [], "Giving profile was not found"],
		[
			"the user has no CCB link",
			[{ ...linkedUser, ccbId: null }],
			"CCB giving profile is not linked",
		],
	])("keeps the not-found message when %s", async (_case, users, message) => {
		const { data } = await runQuery(() => Promise.resolve(users), neverCalled);

		expect(data).toEqual({
			myGivingHistory: { __typename: "MyGivingHistoryNotFoundError", message },
		});
	});
});
