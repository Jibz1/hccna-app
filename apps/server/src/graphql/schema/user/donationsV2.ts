import { users } from "@/db/schema/users";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { GivingService, type DonationCacheResult } from "@/effect/services/GivingService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { eq } from "drizzle-orm";
import { Cause, Effect } from "effect";

import { UserPreviousFiveYearsDonationsFields } from "./givings";

import type { GraphQLContext } from "@/graphql/context";

interface MyGivingHistorySuccess {
	_tag: "MyGivingHistorySuccess";
	years: DonationCacheResult[];
}

interface MyGivingHistoryFetchError {
	_tag: "MyGivingHistoryFetchError";
	message: string;
}

interface MyGivingHistoryNotFoundError {
	_tag: "MyGivingHistoryNotFoundError";
	message: string;
}

type MyGivingHistoryResult =
	| MyGivingHistorySuccess
	| MyGivingHistoryFetchError
	| MyGivingHistoryNotFoundError;

const MyGivingHistorySuccessType = builder
	.objectRef<MyGivingHistorySuccess>("MyGivingHistorySuccess")
	.implement({
		fields: (t) => ({
			years: t.field({
				type: [UserPreviousFiveYearsDonationsFields],
				description: "Previous five years of giving",
				resolve: (root) => root.years,
			}),
		}),
	});

const MyGivingHistoryFetchErrorType = builder
	.objectRef<MyGivingHistoryFetchError>("MyGivingHistoryFetchError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message describing what went wrong",
			}),
		}),
	});

const MyGivingHistoryNotFoundErrorType = builder
	.objectRef<MyGivingHistoryNotFoundError>("MyGivingHistoryNotFoundError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message when giving data cannot be found",
			}),
		}),
	});

const MyGivingHistoryResultType = builder.unionType("MyGivingHistoryResult", {
	types: [
		MyGivingHistorySuccessType,
		MyGivingHistoryFetchErrorType,
		MyGivingHistoryNotFoundErrorType,
	],
	resolveType: (value) => {
		switch (value._tag) {
			case "MyGivingHistorySuccess": {
				return MyGivingHistorySuccessType;
			}
			case "MyGivingHistoryFetchError": {
				return MyGivingHistoryFetchErrorType;
			}
			case "MyGivingHistoryNotFoundError": {
				return MyGivingHistoryNotFoundErrorType;
			}
		}
	},
});

const getCurrentGivingUser = (currentUserUid: string) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		const [user] = yield* Effect.tryPromise({
			try: () =>
				db
					.select({
						id: users.id,
						ccbId: users.ccbId,
						ccbFamilyId: users.ccbFamilyId,
					})
					.from(users)
					.where(eq(users.firebaseUid, currentUserUid))
					.limit(1),
			catch: (error) => error,
		});

		return user;
	}).pipe(Effect.withSpan("GraphQL.getCurrentGivingUser"));

/**
 * Resolver for getPreviousFiveYearsGivingV2 GraphQL field.
 * GraphQL owns authentication and user lookup; GivingService owns donation retrieval.
 */
const resolvePreviousFiveYearsGivingV2 = async (
	ctx: GraphQLContext,
): Promise<DonationCacheResult[] | undefined> => {
	const { currentUserUid } = ctx;

	if (!currentUserUid) {
		return;
	}

	const user = await ctx.effect.runPromise(getCurrentGivingUser(currentUserUid));

	if (!user) {
		return;
	}

	const { id: userId, ccbFamilyId, ccbId } = user;
	if (!ccbFamilyId || !ccbId) {
		return;
	}

	const effect = Effect.gen(function* () {
		const giving = yield* GivingService;
		return yield* giving.getPreviousFiveYears({
			userId,
			ccbFamilyId,
			ccbId,
		});
	}).pipe(Effect.withSpan("GraphQL.getPreviousFiveYearsGivingV2"));

	return ctx.effect.runPromise(effect);
};

/** Clients get a fixed message; the log keeps the cause, without emails or CCB ids. */
const toGivingFetchError = (step: "lookupUser" | "fetchGiving") => (cause: Cause.Cause<unknown>) =>
	Effect.logError("Failed to fetch giving history").pipe(
		Effect.annotateLogs({ operation: "myGivingHistory", step, error: Cause.pretty(cause) }),
		Effect.as<MyGivingHistoryFetchError>({
			_tag: "MyGivingHistoryFetchError",
			message: "Failed to fetch previous five years giving",
		}),
	);

/**
 * Resolver for myGivingHistory GraphQL field.
 * Returns typed success/error objects without changing the V2 field contract.
 */
const resolveMyGivingHistory = async (ctx: GraphQLContext): Promise<MyGivingHistoryResult> => {
	const { currentUserUid } = ctx;

	if (!currentUserUid) {
		return {
			_tag: "MyGivingHistoryNotFoundError",
			message: "Authenticated user was not found",
		};
	}

	const lookupUser = getCurrentGivingUser(currentUserUid).pipe(
		Effect.map((user) => ({ _tag: "Success" as const, user })),
		Effect.catchCause(toGivingFetchError("lookupUser")),
	);
	const userResult = await ctx.effect.runPromise(lookupUser);

	if (userResult._tag === "MyGivingHistoryFetchError") {
		return userResult;
	}

	const { user } = userResult;

	if (!user) {
		return {
			_tag: "MyGivingHistoryNotFoundError",
			message: "Giving profile was not found",
		};
	}

	const { id: userId, ccbFamilyId, ccbId } = user;
	if (!ccbFamilyId || !ccbId) {
		return {
			_tag: "MyGivingHistoryNotFoundError",
			message: "CCB giving profile is not linked",
		};
	}

	const effect = Effect.gen(function* () {
		const giving = yield* GivingService;
		const years = yield* giving.getPreviousFiveYears({
			userId,
			ccbFamilyId,
			ccbId,
		});

		return {
			_tag: "MyGivingHistorySuccess" as const,
			years,
		};
	}).pipe(
		Effect.withSpan("GraphQL.myGivingHistory"),
		Effect.catchCause(toGivingFetchError("fetchGiving")),
	);

	return ctx.effect.runPromise(effect);
};

builder.queryField("getPreviousFiveYearsGivingV2", (t) =>
	t.field({
		type: [UserPreviousFiveYearsDonationsFields],
		authScopes: authScope.signedIn,
		resolve: (_, __, ctx) => resolvePreviousFiveYearsGivingV2(ctx),
	}),
);

builder.queryField("myGivingHistory", (t) =>
	t.field({
		type: MyGivingHistoryResultType,
		authScopes: authScope.signedIn,
		description: "Get the current user's giving history with typed success and error responses",
		resolve: (_, __, ctx) => resolveMyGivingHistory(ctx),
	}),
);
