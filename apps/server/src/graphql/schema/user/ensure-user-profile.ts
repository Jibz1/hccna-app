import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import {
	ensureUserProfileEffect,
	type EnsureUserProfileResult,
	EnsureUserProfileRetryableError,
} from "@/services/onboarding/ensureUserProfile";
import * as Sentry from "@sentry/bun";
import { Effect } from "effect";

type EnsureUserProfileStatus =
	| "READY"
	| "ENRICHMENT_PENDING"
	| "RETRYABLE_ERROR"
	| "IDENTITY_CONFLICT";

/**
 * Flat GraphQL projection of the service's tagged provisioning result.
 *
 * The service models the outcome as a discriminated union, but the mutation's
 * public shape has to stay a plain object: shipped mobile binaries select
 * `created`/`message`/`success` directly and cannot be updated retroactively.
 * Selecting those fields on a union is a validation error, so the union stays
 * internal and is flattened here.
 */
interface EnsureUserProfileOutcome {
	readonly success: boolean;
	readonly created: boolean;
	readonly repaired: boolean;
	readonly status: EnsureUserProfileStatus;
	readonly message: string;
}

const EnsureUserProfileStatusEnum = builder.enumType("EnsureUserProfileStatus", {
	values: ["READY", "ENRICHMENT_PENDING", "RETRYABLE_ERROR", "IDENTITY_CONFLICT"] as const,
});

const EnsureUserProfileResultType = builder
	.objectRef<EnsureUserProfileOutcome>("EnsureUserProfileResult")
	.implement({
		fields: (t) => ({
			success: t.exposeBoolean("success", {
				description: "Whether the profile now exists in both stores",
			}),
			created: t.exposeBoolean("created", {
				description: "True when neither store previously contained the profile",
			}),
			repaired: t.exposeBoolean("repaired", {
				description: "True when one store was reconstructed from the other",
			}),
			status: t.field({
				type: EnsureUserProfileStatusEnum,
				description: "Machine-readable provisioning outcome",
				resolve: (root) => root.status,
			}),
			message: t.exposeString("message", {
				description: "Human-readable status",
			}),
		}),
	});

const failed = (
	status: Extract<EnsureUserProfileStatus, "RETRYABLE_ERROR" | "IDENTITY_CONFLICT">,
	message: string,
): EnsureUserProfileOutcome => ({
	success: false,
	created: false,
	repaired: false,
	status,
	message,
});

const toOutcome = (result: EnsureUserProfileResult): EnsureUserProfileOutcome => {
	switch (result._tag) {
		case "EnsureUserProfileSuccess": {
			return {
				success: true,
				created: result.created,
				repaired: result.repaired,
				status: result.enrichmentPending ? "ENRICHMENT_PENDING" : "READY",
				message: result.message,
			};
		}
		case "EnsureUserProfileRetryableError": {
			return failed("RETRYABLE_ERROR", result.message);
		}
		case "EnsureUserProfileIdentityConflictError": {
			return failed("IDENTITY_CONFLICT", result.message);
		}
	}
};

const resolveEnsureUserProfile = Effect.fn("GraphQL.ensureUserProfile.resolve")(
	function* (uid: string, email: string) {
		return yield* ensureUserProfileEffect({ uid, email });
	},
	Effect.catchTags({
		EnsureUserProfileRetryableError: (error) => Effect.succeed(error),
		EnsureUserProfileIdentityConflictError: (error) =>
			Effect.sync(() =>
				Sentry.captureException(
					new Error(`ensureUserProfile identity conflict for uid ${error.uid}`),
				),
			).pipe(Effect.as(error)),
	}),
);

builder.mutationField("ensureUserProfile", (t) =>
	t.field({
		type: EnsureUserProfileResultType,
		authScopes: authScope.signedIn,
		description:
			"Idempotently provisions and reconciles the caller's user profile from their verified Firebase identity. Safe to call on every sign-in.",
		resolve: (_, __, ctx): Promise<EnsureUserProfileOutcome> | EnsureUserProfileOutcome => {
			const uid = ctx.currentUserUid;
			const email = ctx.currentUserEmail;
			if (!uid || !email) {
				return toOutcome(
					new EnsureUserProfileRetryableError({
						message: "User not authenticated",
					}),
				);
			}

			return ctx.effect.runPromise(resolveEnsureUserProfile(uid, email)).then(toOutcome);
		},
	}),
);
