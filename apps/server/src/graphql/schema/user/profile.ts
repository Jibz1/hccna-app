import { loadViaDataLoader } from "@/effect/DataLoaderFactory";
import { GivingService } from "@/effect/services/GivingService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { createWOADataLoaderKey } from "@/graphql/loaders/woaDataLoader";
import { ensureUserProfileEffect } from "@/services/onboarding/ensureUserProfile";
import * as Sentry from "@sentry/bun";
import { Effect } from "effect";

import { UserPreviousFiveYearsDonationsFields } from "./givings";
import { WordOfActivationRef } from "./woa";

import type { users } from "@/db/schema/users";
import type { GraphQLContext } from "@/graphql/context";

// ═══════════════════════════════════════════════════════════════
// EFFECTS
// ═══════════════════════════════════════════════════════════════

/**
 * Create the caller's profile from their verified Firebase identity when no
 * row exists yet. The client normally does this through `ensureUserProfile`
 * right after sign-in, but that call can be lost (network, proxy challenge,
 * old binaries), leaving an Auth user with no profile. Provisioning is
 * idempotent and dual-writes both stores, so doing it here on the first
 * authenticated read closes that gap without a schema change.
 *
 * Failures degrade to the pre-existing contract (a null profile) so the
 * client's own retry path still applies.
 */
const provisionMissingProfile = Effect.fn("Profile.provisionMissing")(function* (
	ctx: Pick<GraphQLContext, "loaders">,
	input: { readonly uid: string; readonly email: string },
) {
	const result = yield* Effect.result(ensureUserProfileEffect(input));
	if (result._tag === "Failure") {
		const error = result.failure;
		if (error._tag === "EnsureUserProfileIdentityConflictError") {
			Sentry.captureException(
				new Error(`profile provision identity conflict for uid ${error.uid}`),
			);
		}
		yield* Effect.logWarning("profile provision on miss failed").pipe(
			Effect.annotateLogs({ uid: input.uid, reason: error._tag, message: error.message }),
		);
		return null;
	}
	// The request loader memoized the miss; drop it so the re-read sees the row.
	ctx.loaders.dbProfile.clear(input.uid);
	return yield* loadViaDataLoader(ctx.loaders.dbProfile, input.uid, "dbProfile");
});

const resolveProfile = Effect.fn("Profile.getByFirebaseUid")(function* (
	ctx: Pick<GraphQLContext, "loaders" | "currentUserEmail">,
	firebaseUid: string,
) {
	let profile = yield* loadViaDataLoader(ctx.loaders.dbProfile, firebaseUid, "dbProfile");
	if (!profile && ctx.currentUserEmail) {
		profile = yield* provisionMissingProfile(ctx, {
			uid: firebaseUid,
			email: ctx.currentUserEmail,
		});
	}

	return profile;
});

const resolveProfileGivingHistory = Effect.fn("Profile.givingHistory.resolve")(function* ({
	userId,
	ccbFamilyId,
	ccbId,
}: {
	readonly userId: string;
	readonly ccbFamilyId: string;
	readonly ccbId: string;
}) {
	const giving = yield* GivingService;
	return yield* giving.getPreviousFiveYears({
		userId,
		ccbFamilyId,
		ccbId,
	});
});

const resolveProfileWoa = Effect.fn("Profile.woa.resolve")(
	function* (
		ctx: Pick<GraphQLContext, "currentUserUid" | "loaders">,
		{
			email,
			userId,
		}: {
			readonly email: string;
			readonly userId: string;
		},
	) {
		const wordOfActivation = yield* loadViaDataLoader(
			ctx.loaders.woa,
			createWOADataLoaderKey({
				email,
				userId: ctx.currentUserUid ?? userId,
			}),
			"woa",
		);

		return wordOfActivation?.text ? { ...wordOfActivation, email } : null;
	},
	Effect.catchTag("DataLoaderError", () => Effect.succeed(null)),
);

// ═══════════════════════════════════════════════════════════════
// USER PROFILE TYPE
// ═══════════════════════════════════════════════════════════════

const UserProfileRef = builder.objectRef<typeof users.$inferSelect>("UserDBProfile").implement({
	description: "User profile from database",
	fields: (t) => ({
		// ─────────────────────────────────────────────────────────────
		// Identity
		// ─────────────────────────────────────────────────────────────
		id: t.exposeString("id"),
		preferredCampusSlug: t.string({
			nullable: true,
			resolve: async (parent, _, ctx) => {
				const preference = await ctx.loaders.campusPreference.load(parent.firebaseUid);
				return preference.preferredCampusSlug;
			},
		}),
		campusPreferenceVersion: t.int({
			nullable: false,
			resolve: async (parent, _, ctx) => {
				const preference = await ctx.loaders.campusPreference.load(parent.firebaseUid);
				return preference.campusPreferenceVersion;
			},
		}),
		email: t.exposeString("email"),
		firstName: t.exposeString("firstName", { nullable: true }),
		lastName: t.exposeString("lastName", { nullable: true }),
		img: t.exposeString("img", { nullable: true }),

		// ─────────────────────────────────────────────────────────────
		// Contact & Auth
		// ─────────────────────────────────────────────────────────────
		phone: t.exposeString("phone", { nullable: true }),
		provider: t.exposeString("provider", { nullable: true }),
		isVerified: t.exposeBoolean("isVerified"),

		// ─────────────────────────────────────────────────────────────
		// CCB Integration
		// ─────────────────────────────────────────────────────────────
		ccbId: t.exposeString("ccbId", { nullable: true }),
		ccbFamilyId: t.exposeString("ccbFamilyId", { nullable: true }),

		// ─────────────────────────────────────────────────────────────
		// Timestamps
		// ─────────────────────────────────────────────────────────────
		createdAt: t.field({
			type: "DateTime",
			resolve: (parent) => parent.createdAt,
		}),
		updatedAt: t.field({
			type: "DateTime",
			resolve: (parent) => parent.updatedAt,
		}),

		// ─────────────────────────────────────────────────────────────
		// Computed: Giving History
		// ─────────────────────────────────────────────────────────────
		givingHistory: t.field({
			type: [UserPreviousFiveYearsDonationsFields],
			nullable: true,
			description: "Previous five years of giving",
			resolve: (parent, _args, ctx) => {
				const { id: userId, ccbFamilyId, ccbId } = parent;

				if (!ccbFamilyId || !ccbId) {
					return null;
				}

				return ctx.effect.runPromise(
					resolveProfileGivingHistory({
						userId,
						ccbFamilyId,
						ccbId,
					}),
				);
			},
		}),

		// ─────────────────────────────────────────────────────────────
		// Computed: Word of Activation
		// ─────────────────────────────────────────────────────────────
		woa: t.field({
			type: WordOfActivationRef,
			nullable: true,
			description: "Word of Activation for the current month",
			resolve: (parent, _args, ctx) => {
				const { email, id } = parent;
				if (!email) {
					return null;
				}

				return ctx.effect.runPromise(resolveProfileWoa(ctx, { email, userId: id }));
			},
		}),
	}),
});

// ═══════════════════════════════════════════════════════════════
// QUERY: Get Current User Profile
// ═══════════════════════════════════════════════════════════════

builder.queryField("profile", (t) =>
	t.field({
		type: UserProfileRef,
		nullable: true,
		description: "Get the current authenticated user profile",
		authScopes: authScope.signedIn,
		resolve: (_, __, ctx) => {
			const { currentUserUid } = ctx;

			if (!currentUserUid) {
				return null;
			}

			return ctx.effect.runPromise(resolveProfile(ctx, currentUserUid));
		},
	}),
);
