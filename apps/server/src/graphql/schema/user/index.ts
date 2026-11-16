import { loadViaDataLoader } from "@/effect/DataLoaderFactory";
import { CCBService } from "@/effect/services/CCBService";
import { parseGiving } from "@/effect/services/giving/parseGiving";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { createWOADataLoaderKey } from "@/graphql/loaders/woaDataLoader";
import { createRedisCache } from "@/utils/redisCache";
import { Temporal } from "@js-temporal/polyfill";
import { DateTime, Effect } from "effect";

import { Department } from "./departments";
import { EventAttendanceRef } from "./event-coordinator";
import { UserDonationsFields, UserPreviousFiveYearsDonationsFields } from "./givings";
import { User } from "./user";
import { WordOfActivationRef } from "./woa";

import type { GraphQLContext } from "@/graphql/context";

interface UserProfileData {
	email: string;
	uid: string;
	firstName: string;
	lastName: string;
	departments: {
		id: number;
		slug: string;
		ccbId: string;
		name: string;
		image: string;
		description: string;
		link: string;
		fullName: string;
	}[];
	img: string;
	isVerified: boolean;
	enrichmentPending: boolean;
	phone: string;
	provider: string;
	ccbId: string;
	ccbFamilyId: string;
	createdAt: string;
}

const previousFiveYearsGivingCache = createRedisCache<
	(ReturnType<typeof parseGiving> & { year: number })[]
>({
	prefix: "previousFiveYearsGivingByMember",
	ttl: Temporal.Duration.from({ hours: 2160 }),
	staleDuration: Temporal.Duration.from({ hours: 168 }),
});

type UserResolverContext = Pick<GraphQLContext, "loaders">;

const resolveUserProfile = Effect.fn("User.profile.resolve")(
	function* (ctx: UserResolverContext, currentUserUid: string) {
		const dbUser = yield* loadViaDataLoader(ctx.loaders.dbProfile, currentUserUid, "dbProfile");

		if (!dbUser) {
			return null;
		}

		return {
			email: dbUser.email,
			uid: dbUser.firebaseUid,
			firstName: dbUser.firstName ?? "",
			lastName: dbUser.lastName ?? "",
			departments: [],
			img: dbUser.img ?? "",
			isVerified: dbUser.isVerified,
			enrichmentPending: dbUser.enrichmentPending,
			phone: dbUser.phone ?? "",
			provider: dbUser.provider ?? "",
			ccbId: dbUser.ccbId ?? "",
			ccbFamilyId: dbUser.ccbFamilyId ?? "",
			createdAt: dbUser.createdAt.toISOString(),
		} satisfies UserProfileData;
	},
	Effect.catchTag("DataLoaderError", () => Effect.succeed(null)),
);

const resolveUserDonations = Effect.fn("User.donations.resolve")(function* (
	ctx: UserResolverContext,
	currentUserUid: string,
) {
	const userProfile = yield* loadViaDataLoader(
		ctx.loaders.userProfile,
		currentUserUid,
		"userProfile",
	);
	if (!userProfile) {
		return null;
	}

	const { ccbFamilyId, ccbId } = userProfile;
	if (!ccbFamilyId || !ccbId) {
		return null;
	}

	const year = DateTime.getPartUtc(yield* DateTime.now, "year");
	const ccb = yield* CCBService;
	const giving = yield* ccb.getGiving(ccbFamilyId, year);
	return parseGiving(giving, ccbId, year);
});

export const resolvePreviousFiveYearsGiving = Effect.fn("User.getPreviousFiveYearsGiving.resolve")(
	function* (
		ctx: UserResolverContext,
		currentUserUid: string,
		cache: Pick<typeof previousFiveYearsGivingCache, "get" | "set"> = previousFiveYearsGivingCache,
	) {
		const userProfile = yield* loadViaDataLoader(
			ctx.loaders.userProfile,
			currentUserUid,
			"userProfile",
		);
		if (!userProfile) {
			return null;
		}

		const { ccbFamilyId, ccbId } = userProfile;
		if (!ccbFamilyId || !ccbId) {
			return null;
		}

		const now = yield* DateTime.now;
		const currentYear = DateTime.getPartUtc(now, "year");
		const years = Array.from({ length: 5 }, (_, index) => currentYear - index);
		const cacheKey = `${ccbFamilyId}:${ccbId}:${years.join(",")}`;
		const cached = yield* Effect.promise(() => cache.get(cacheKey));

		if (cached?.value) {
			return cached.value;
		}

		const ccb = yield* CCBService;
		const results = yield* Effect.forEach(
			years,
			Effect.fnUntraced(function* (year) {
				const giving = yield* ccb.getGiving(ccbFamilyId, year);
				return { ...parseGiving(giving, ccbId, year), year };
			}),
			{ concurrency: "unbounded" },
		);

		yield* Effect.promise(() => cache.set(cacheKey, results));
		return results;
	},
);

const resolveUserWoa = Effect.fn("User.woa.resolve")(function* (
	ctx: Pick<GraphQLContext, "currentUserEmail" | "currentUserUid" | "loaders">,
) {
	const { currentUserEmail, currentUserUid } = ctx;
	if (!currentUserEmail || !currentUserUid) {
		return null;
	}

	const userProfile = yield* loadViaDataLoader(
		ctx.loaders.userProfile,
		currentUserUid,
		"userProfile",
	);
	if (!userProfile) {
		return null;
	}

	const wordActivationData = yield* loadViaDataLoader(
		ctx.loaders.woa,
		createWOADataLoaderKey({
			email: currentUserEmail,
			userId: currentUserUid,
		}),
		"woa",
	);

	if (!wordActivationData?.text) {
		yield* Effect.logWarning("[UserSchema] Word of activation not found").pipe(
			Effect.annotateLogs({ userUid: currentUserUid }),
		);
		return null;
	}

	return { ...wordActivationData, email: currentUserEmail };
});

export const UserRef = builder.objectRef<User>("User");

const ProfileFields = builder.objectRef<UserProfileData>("UserProfile").implement({
	fields: (t) => ({
		preferredCampusSlug: t.string({
			nullable: true,
			resolve: async (parent, _, ctx) => {
				const preference = await ctx.loaders.campusPreference.load(parent.uid);
				return preference.preferredCampusSlug;
			},
		}),
		campusPreferenceVersion: t.int({
			nullable: false,
			resolve: async (parent, _, ctx) => {
				const preference = await ctx.loaders.campusPreference.load(parent.uid);
				return preference.campusPreferenceVersion;
			},
		}),
		email: t.exposeString("email", {
			description: "User email",
		}),

		uid: t.exposeString("uid", {
			description: "User uid",
		}),
		firstName: t.exposeString("firstName", {
			description: "User first name",
		}),
		lastName: t.exposeString("lastName", {
			description: "User last name",
		}),

		departments: t.field({
			description: "Sermons List",
			type: [Department],
			resolve: (root) => root.departments,
		}),

		img: t.exposeString("img", {
			description: "User image",
		}),
		isVerified: t.exposeBoolean("isVerified", {
			description: "User is verified",
		}),
		enrichmentPending: t.exposeBoolean("enrichmentPending", {
			nullable: false,
			description: "Whether signup directory enrichment is still pending for this profile",
		}),
		phone: t.exposeString("phone", {
			description: "User phone",
		}),
		provider: t.exposeString("provider", {
			description: "User provider",
		}),
		ccbId: t.exposeString("ccbId", {
			description: "User ccb id",
		}),
		ccbFamilyId: t.exposeString("ccbFamilyId", {
			description: "User ccb family id",
		}),
		createdAt: t.exposeString("createdAt", {
			description: "User created at",
		}),
	}),
});

UserRef.implement({
	authScopes: authScope.signedIn,
	fields: (t) => ({
		profile: t.field({
			type: ProfileFields,
			authScopes: authScope.signedIn,
			resolve: (_, __, ctx) => {
				const { currentUserUid } = ctx;
				if (!currentUserUid) {
					return null;
				}

				return ctx.effect.runPromise(resolveUserProfile(ctx, currentUserUid));
			},
		}),
		donations: t.field({
			type: UserDonationsFields,
			deprecationReason: "use getPreviousFiveYearsGiving query field instead",
			authScopes: authScope.signedIn,
			resolve: (_, __, ctx) => {
				const { currentUserUid } = ctx;

				if (!currentUserUid) {
					return null;
				}

				return ctx.effect.runPromise(resolveUserDonations(ctx, currentUserUid));
			},
		}),
		getPreviousFiveYearsGiving: t.field({
			type: [UserPreviousFiveYearsDonationsFields],
			authScopes: authScope.signedIn,
			description: "Get the previous five years of giving for the user",
			resolve: (_, __, ctx) => {
				const { currentUserUid } = ctx;

				if (!currentUserUid) {
					return null;
				}

				return ctx.effect.runPromise(resolvePreviousFiveYearsGiving(ctx, currentUserUid));
			},
		}),
		woa: t.field({
			type: WordOfActivationRef,
			nullable: true,
			authScopes: authScope.signedIn,
			resolve: (_, __, ctx) => ctx.effect.runPromise(resolveUserWoa(ctx)),
		}),
		eventAttendance: t.field({
			nullable: true,
			authScopes: authScope.signedIn,
			type: t.listRef(EventAttendanceRef, {
				nullable: true,
			}),
			deprecationReason: "use kidsEventAttendance query field",
			// oxlint-disable-next-line no-null
			resolve: () => null,
		}),
	}),
});

builder.queryFields((t) => ({
	user: t.field({
		nullable: false,
		type: UserRef,
		authScopes: authScope.signedIn,

		resolve: (_, __, ctx) => new User({ ctx }),
	}),
	// update user profile
}));
