import {
	UserProfileUpdateService,
	type UserNotAuthenticatedError,
	type UserNotFoundError,
	type UserProfileUpdateError,
} from "@/effect/services/UserProfileUpdateService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import {
	createVerifyAndCleanupEffect,
	deleteAccountEffect,
	deleteUserFireStoreEffect,
	generateAuthSignInCodeAndSendEmailEffect,
	generateEmailVerificationLinkEffect,
	verifyAuthSignInCodeEffect,
	type CodeExpiredError,
	type InvalidCodeError,
	type MaxAttemptsError,
} from "@/graphql/schema/user/user";
import { auth } from "@/utils/firebase";
import * as Sentry from "@sentry/bun";
import { Cause, Effect, Result, Schema } from "effect";
import { GraphQLError } from "graphql";

import type { UserRecord } from "firebase-admin/auth";

const GRAPHQL_INT_MAX = 2_147_483_647;
const GRAPHQL_INT_MIN = -2_147_483_648;

const UpdateProfileInputSchema = Schema.Struct({
	firstName: Schema.optional(Schema.String),
	lastName: Schema.optional(Schema.String),
	phone: Schema.optional(Schema.String),
	img: Schema.optional(Schema.String),
}).check(
	Schema.makeFilter((data) =>
		data.firstName !== undefined ||
		data.lastName !== undefined ||
		data.phone !== undefined ||
		data.img !== undefined
			? undefined
			: {
					path: ["input"],
					issue: "At least one field must be provided",
				},
	),
);
type UpdateProfileInput = typeof UpdateProfileInputSchema.Type;

const parseUpdateProfileInput = <Input>(input: Input): typeof UpdateProfileInputSchema.Type => {
	const result = Schema.decodeUnknownResult(UpdateProfileInputSchema)(input);
	if (Result.isSuccess(result)) {
		return result.success;
	}

	throw new GraphQLError("Invalid updateUserProfile input", {
		extensions: {
			code: "BAD_USER_INPUT",
			issues: String(result.failure),
		},
	});
};

const UpdateUserProfileInput = builder.inputType("UpdateUserProfileInput", {
	fields: (t) => ({
		firstName: t.string({
			required: false,
			description: "User first name",
		}),
		lastName: t.string({
			required: false,
			description: "User last name",
		}),
		phone: t.string({
			required: false,
			description: "User phone",
		}),
		img: t.string({
			required: false,
			description: "User image",
		}),
	}),
});

const UpdateUserProfileResult = builder
	.objectRef<{
		success: boolean;
		message: string;
	}>("UpdateUserProfile")
	.implement({
		fields: (t) => ({
			success: t.boolean({
				description: "Update result success",
				resolve: (root) => root.success,
			}),
			message: t.string({
				description: "Update result message",
				resolve: (root) => root.message,
			}),
		}),
	});

const CreateSignInOrDeleteAccountCodeResult = builder
	.objectRef<{
		success: boolean;
		message: string;
		countDownTime?: number;
		countDownTimeMs?: number;
	}>("CreateSignInOrDeleteAccountCodeResult")
	.implement({
		fields: (t) => ({
			success: t.boolean({
				description: "Create code result success",
				resolve: (root) => root.success,
			}),
			message: t.string({
				description: "Create/Delete account code result message",
				resolve: (root) => root.message,
			}),
			countDownTime: t.int({
				nullable: true,
				description:
					"Code expiration timestamp in milliseconds (deprecated, use countDownTimeMs; null when out of GraphQL Int range)",
				deprecationReason: "Use countDownTimeMs instead. countDownTime is deprecated.",
				resolve: (root) => {
					const value = root.countDownTime ?? root.countDownTimeMs;
					if (
						value === undefined ||
						!Number.isInteger(value) ||
						value < GRAPHQL_INT_MIN ||
						value > GRAPHQL_INT_MAX
					) {
						return null;
					}
					return value;
				},
			}),
			countDownTimeMs: t.float({
				nullable: true,
				description: "Code expiration timestamp in milliseconds",
				resolve: (root) => root.countDownTimeMs ?? root.countDownTime ?? undefined,
			}),
		}),
	});

const VerifySignInCodeResult = builder
	.objectRef<{
		success: boolean;
		message: string;
		token?: string;
	}>("VerifySignInCodeResult")
	.implement({
		fields: (t) => ({
			success: t.boolean({
				description: "Verify sign in code result success",
				resolve: (root) => root.success,
			}),
			message: t.string({
				description: "Verify sign in code result message",
				resolve: (root) => root.message,
			}),
			token: t.string({
				description: "Verify sign in code result token",
				resolve: (root) => root.token,
			}),
		}),
	});

const CreateEmailLinkResult = builder
	.objectRef<{
		success: boolean;
		message: string;
	}>("CreateEmailLinkResult")
	.implement({
		fields: (t) => ({
			success: t.boolean({
				description: "Create email link result success",
				resolve: (root) => root.success,
			}),
			message: t.string({
				description: "Create email link result message",
				resolve: (root) => root.message,
			}),
		}),
	});

const reportDeleteAccountError = (error: { message: string; cause?: unknown }) =>
	Effect.sync(() => {
		Sentry.captureException(error.cause ?? error);
		return {
			success: false,
			message: error.message,
		};
	});

const failureResult = (message: string) => ({
	success: false,
	message,
});

const recoverWithMessage = (error: { message: string }) =>
	Effect.succeed(failureResult(error.message));

const createCodeResult = (message: string, countDownTime: number) => ({
	success: true,
	message,
	countDownTime,
	countDownTimeMs: countDownTime,
});

// Recovers from the full cause (expected errors AND defects) so these auth
// mutations always resolve to the { success, message } shape the clients
// expect, matching the pre-Effect try/catch contract. The manual Sentry
// capture is load-bearing: once the failure becomes a success fallback, the
// GraphQL-level Sentry plugin never sees it.
const reportAndFallback = (fallbackMessage: string) => (cause: Cause.Cause<unknown>) =>
	Effect.sync(() => {
		const error = Cause.squash(cause);
		Sentry.captureException(error);
		return {
			success: false,
			message: error instanceof Error ? error.message : fallbackMessage,
		};
	});

const updateUserProfileResolverEffect = Effect.fn("updateUserProfile.resolve")(
	function* (currentUserUid: string | null, profileInput: UpdateProfileInput) {
		const service = yield* UserProfileUpdateService;
		return yield* service.updateUserProfileV2(currentUserUid, {
			firstName: profileInput.firstName ?? undefined,
			lastName: profileInput.lastName ?? undefined,
			phone: profileInput.phone ?? undefined,
			img: profileInput.img ?? undefined,
		});
	},
	Effect.catchTags({
		UserNotAuthenticatedError: (error: UserNotAuthenticatedError) => recoverWithMessage(error),
		UserNotFoundError: (error: UserNotFoundError) => recoverWithMessage(error),
		UserProfileUpdateError: (error: UserProfileUpdateError) => recoverWithMessage(error),
	}),
);

const createEmailLinkResolverEffect = Effect.fn("createEmailLink.resolve")(
	function* (email: string) {
		if (!email) {
			return failureResult("Email is required");
		}

		yield* generateEmailVerificationLinkEffect(email);
		return {
			success: true,
			message: "Email link created successfully",
		};
	},
	Effect.catchCause(reportAndFallback("Failed to create email link")),
);

const createSignInCodeResolverEffect = Effect.fn("createSignInCode.resolve")(
	function* (email: string) {
		if (!email) {
			return failureResult("Email is required");
		}

		const { countDownTime } = yield* generateAuthSignInCodeAndSendEmailEffect({
			email,
			codeType: "auth",
		});
		return createCodeResult("Sign in code sent successfully", countDownTime);
	},
	// A locked address is an expected refusal, not a failure to report.
	Effect.catchTag("MaxAttemptsError", (error: MaxAttemptsError) => recoverWithMessage(error)),
	Effect.catchCause(reportAndFallback("Failed to send sign in code")),
);

const verifySignInCodeResolverEffect = Effect.fn("verifySignInCode.resolve")(
	function* (email: string, code: string) {
		if (!code) {
			return failureResult("Code is required");
		}
		if (!email) {
			return failureResult("Email is required");
		}

		const { token } = yield* verifyAuthSignInCodeEffect({
			email,
			code,
		});
		return {
			success: true,
			message: "Sign in code verified successfully",
			token,
		};
	},
	Effect.catchTags({
		InvalidCodeError: (error: InvalidCodeError) => recoverWithMessage(error),
		CodeExpiredError: (error: CodeExpiredError) => recoverWithMessage(error),
		MaxAttemptsError: (error: MaxAttemptsError) => recoverWithMessage(error),
	}),
	Effect.catchCause(reportAndFallback("Failed to verify sign in code")),
);

const requestDeleteAccountResolverEffect = Effect.fn("requestDeleteAccount.resolve")(
	function* (currentUserEmail: string | null) {
		if (!currentUserEmail) {
			return failureResult("User not authenticated");
		}

		const { countDownTime } = yield* generateAuthSignInCodeAndSendEmailEffect({
			email: currentUserEmail,
			codeType: "delete",
		});
		return createCodeResult("Delete account request sent successfully", countDownTime);
	},
	Effect.catchTag("MaxAttemptsError", (error: MaxAttemptsError) => recoverWithMessage(error)),
	Effect.catchCause(reportAndFallback("Failed to request delete account")),
);

const postDeletionCleanupResolverEffect = Effect.fn("postDeletionCleanup.resolve")(
	function* (uid: string, email: string, getUserByEmail: (email: string) => Promise<UserRecord>) {
		return yield* createVerifyAndCleanupEffect({
			uid,
			email,
			getUserByEmail,
			deleteUserFireStore: deleteUserFireStoreEffect,
		});
	},
	Effect.catchTags({
		AccountDeletionError: reportDeleteAccountError,
	}),
	Effect.catchCause(reportAndFallback("Cleanup failed")),
);

const verifyDeleteAccountCodeResolverEffect = Effect.fn("verifyDeleteAccountCode.resolve")(
	function* (currentUserEmail: string | null, code: string) {
		if (!code) {
			return failureResult("Code is required");
		}

		if (!currentUserEmail) {
			return failureResult("User not authenticated");
		}

		yield* deleteAccountEffect({
			email: currentUserEmail,
			code,
		});

		return {
			success: true,
			message: "Delete account code verified successfully",
		};
	},
	Effect.catchTags({
		InvalidCodeError: (error: InvalidCodeError) => recoverWithMessage(error),
		CodeExpiredError: (error: CodeExpiredError) => recoverWithMessage(error),
		MaxAttemptsError: (error: MaxAttemptsError) => recoverWithMessage(error),
		FirebaseFetchError: reportDeleteAccountError,
		UserNotFoundError: reportDeleteAccountError,
		TokenCreationError: reportDeleteAccountError,
		AccountDeletionError: reportDeleteAccountError,
	}),
	Effect.catchCause(reportAndFallback("Failed to verify delete account code")),
);

// Account mutations combine Firebase-facing auth flows with Postgres-backed profile data.
builder.mutationFields((t) => ({
	updateUserProfile: t.field({
		type: UpdateUserProfileResult,
		authScopes: authScope.signedIn,
		args: {
			input: t.arg({
				type: UpdateUserProfileInput,
				required: true,
				description: "User profile update data",
			}),
		},
		resolve: (_, { input }, ctx) => {
			const profileInput = parseUpdateProfileInput(input);

			return ctx.effect.runPromise(
				updateUserProfileResolverEffect(ctx.currentUserUid, profileInput),
			);
		},
	}),

	createEmailLink: t.field({
		type: CreateEmailLinkResult,
		authScopes: authScope.clientAuth,
		args: {
			email: t.arg.string({
				required: true,
				description: "User email",
			}),
		},
		resolve: (_, { email }, ctx) => ctx.effect.runPromise(createEmailLinkResolverEffect(email)),
	}),
	createSignInCode: t.field({
		type: CreateSignInOrDeleteAccountCodeResult,
		authScopes: authScope.clientAuth,
		args: {
			email: t.arg.string({
				required: true,
				description: "User email",
			}),
		},
		resolve: (_, { email }, ctx) => ctx.effect.runPromise(createSignInCodeResolverEffect(email)),
	}),
	verifySignInCode: t.field({
		type: VerifySignInCodeResult,
		authScopes: authScope.clientAuth,

		args: {
			code: t.arg.string({
				required: true,
				description: "Sign in code",
			}),
			email: t.arg.string({
				required: true,
				description: "User email",
			}),
		},
		resolve: (_, { code, email }, ctx) =>
			ctx.effect.runPromise(verifySignInCodeResolverEffect(email, code)),
	}),
	requestDeleteAccount: t.field({
		type: CreateSignInOrDeleteAccountCodeResult,
		authScopes: authScope.signedIn,
		description: "Request to delete account",
		resolve: (_, __, ctx) =>
			ctx.effect.runPromise(requestDeleteAccountResolverEffect(ctx.currentUserEmail)),
	}),
	// Triggered by internal systems after Firebase Auth has already removed the user.
	postDeletionCleanup: t.field({
		type: UpdateUserProfileResult,
		authScopes: authScope.googleInternal,
		args: {
			uid: t.arg.string({
				required: true,
				description: "User UID",
			}),
			email: t.arg.string({
				required: true,
				description: "User email",
			}),
		},
		description:
			"Cleans up Firestore user data after Auth account deletion. Called by internal systems after a user account is removed from Firebase Auth.",
		resolve: (_, { uid, email }, ctx) =>
			ctx.effect.runPromise(
				postDeletionCleanupResolverEffect(uid, email, auth.getUserByEmail.bind(auth)),
			),
	}),
	verifyDeleteAccountCode: t.field({
		type: UpdateUserProfileResult,
		authScopes: authScope.signedIn,
		args: {
			code: t.arg.string({
				required: true,
				description: "Delete account code",
			}),
		},
		description: "Verify delete account code",
		resolve: (_, { code }, ctx) =>
			ctx.effect.runPromise(verifyDeleteAccountCodeResolverEffect(ctx.currentUserEmail, code)),
	}),
}));
