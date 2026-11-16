import { CampusPreferenceStore } from "@/effect/services/CampusPreferenceStore";
import { CampusPushService } from "@/effect/services/CampusPushService";
import { ProfileService } from "@/effect/services/ProfileService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";
import { GraphQLError } from "graphql";

const CampusPreferenceResult = builder
	.objectRef<{
		success: boolean;
		preferredCampusSlug: string | null;
		campusPreferenceVersion: number;
		syncPending: boolean;
	}>("CampusPreferenceResult")
	.implement({
		fields: (t) => ({
			success: t.exposeBoolean("success", { nullable: false }),
			preferredCampusSlug: t.exposeString("preferredCampusSlug", { nullable: true }),
			campusPreferenceVersion: t.exposeInt("campusPreferenceVersion", { nullable: false }),
			syncPending: t.exposeBoolean("syncPending", { nullable: false }),
		}),
	});

builder.mutationField("setPreferredCampus", (t) =>
	t.field({
		type: CampusPreferenceResult,
		authScopes: authScope.signedIn,
		description:
			"Save the caller's campus with optimistic concurrency. A false success returns the newer canonical preference. Firestore profile and subscription synchronization may remain pending after the preference is saved.",
		args: {
			campusSlug: t.arg.string({ required: true }),
			expectedVersion: t.arg.int({ required: true }),
		},
		resolve: (_, input, ctx) =>
			ctx.effect.runPromise(
				Effect.gen(function* () {
					const store = yield* CampusPreferenceStore;
					const profile = yield* ProfileService;
					const firebaseUid = ctx.currentUserUid;
					if (!firebaseUid) {
						return yield* Effect.fail(
							new GraphQLError("Sign in to choose a campus", {
								extensions: { code: "UNAUTHENTICATED" },
							}),
						);
					}
					const result = yield* store.set({ ...input, firebaseUid });
					yield* profile.clearCache({
						firebaseUid: result.firebaseUid,
						id: result.userId,
						email: result.email,
					});
					ctx.loaders.dbProfile.clear(firebaseUid);
					ctx.loaders.campusPreference.clear(firebaseUid).prime(firebaseUid, result);
					if (!result.conflict && result.syncPending) {
						const push = yield* CampusPushService;
						yield* push.syncUserInBackground(firebaseUid);
					}
					return { ...result, success: !result.conflict };
				}).pipe(
					Effect.catchTag("InvalidCampusPreferenceError", (error) =>
						Effect.fail(new GraphQLError(error.detail, { extensions: { code: "BAD_USER_INPUT" } })),
					),
					Effect.withSpan("setPreferredCampus.resolve"),
				),
			),
	}),
);
