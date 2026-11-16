import { users } from "@/db/schema/users";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { FirebaseAuthService } from "@/effect/services/FirebaseAuthService";
import { MailService, type MailDataRequired } from "@/effect/services/MailService";
import { ProfileService } from "@/effect/services/ProfileService";
import { memo } from "@/utils/decorators";
import { hashEmail } from "@/utils/hash";
import {
	config as emailTemplateConfig,
	type EmailTemplateID,
} from "@/utils/messages/email/EmailTemplate";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Predicate, Result, Schema } from "effect";
import { randomInt } from "node:crypto";

import type { GraphQLContext } from "@/graphql/context";
// oxlint-disable max-classes-per-file
import type { ActionCodeSettings, UserRecord } from "firebase-admin/auth";
import type { DocumentData } from "firebase-admin/firestore";

export class InvalidCodeError extends Schema.TaggedError<InvalidCodeError>()("InvalidCodeError", {
	message: Schema.String,
}) {}

export class CodeExpiredError extends Schema.TaggedError<CodeExpiredError>()("CodeExpiredError", {
	message: Schema.String,
}) {}

export class UserNotFoundError extends Schema.TaggedError<UserNotFoundError>()(
	"UserNotFoundError",
	{
		message: Schema.String,
	},
) {}

export class TokenCreationError extends Schema.TaggedError<TokenCreationError>()(
	"TokenCreationError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {}

class FirebaseFetchError extends Schema.TaggedError<FirebaseFetchError>()("FirebaseFetchError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

class EmailSendError extends Schema.TaggedError<EmailSendError>()("EmailSendError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

export class AccountDeletionError extends Schema.TaggedError<AccountDeletionError>()(
	"AccountDeletionError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {}

export class MaxAttemptsError extends Schema.TaggedError<MaxAttemptsError>()("MaxAttemptsError", {
	message: Schema.String,
}) {}

type VerifyCodeError = InvalidCodeError | CodeExpiredError | MaxAttemptsError | FirebaseFetchError;

type GenerateCodeError = FirebaseFetchError | EmailSendError | MaxAttemptsError;
type CodeType = "auth" | "delete";

interface AuthCodeInput {
	readonly email: string;
	readonly code: string;
}

interface GenerateAuthCodeInput {
	readonly email: string;
	readonly codeType: CodeType;
}

interface VerifyCodeInput extends AuthCodeInput {
	readonly collection: string;
}

interface CleanupResult {
	readonly success: boolean;
	readonly message: string;
}

interface CreateVerifyAndCleanupInput<R> {
	readonly email: string;
	readonly uid: string;
	readonly getUserByEmail: (email: string) => Promise<UserRecord>;
	readonly deleteUserFireStore: (uid: string) => Effect.Effect<void, AccountDeletionError, R>;
}

export class User {
	ctx: GraphQLContext;
	constructor({ ctx }: { ctx: GraphQLContext }) {
		this.ctx = ctx;
	}

	@memo()
	getProfile() {
		if (!this.ctx.currentUserUid) {
			throw new Error("User not found");
		}
		return this.ctx.loaders.userProfile.load(this.ctx.currentUserUid);
	}

	static fromUserProfileFromId(ctx: GraphQLContext) {
		const uid = ctx.currentUserUid;
		if (!uid) {
			throw new Error("User not found");
		}
		const user = new User({ ctx });
		return user.getProfile();
	}
}

// oxlint-disable-next-line no-warning-comments
// TODO: Switch to 5 minutes when after removing the hardcoded 10 minutes from the mobile app
const EXPIRATION_MINUTES = 10;
const CODE_EXPIRATION_MS = EXPIRATION_MINUTES * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
// How long an address stays locked once its attempts are spent. The lock is stored, so asking
// for a new code cannot buy more guesses.
const LOCKOUT_MS = 15 * 60 * 1000;
const LOCKED_MESSAGE = "Too many failed attempts. Please try again later.";

const isLocked = (data: DocumentData | undefined, nowMs: number) =>
	Predicate.isNumber(data?.lockedUntil) && data.lockedUntil > nowMs;

const isUnexpired = (data: DocumentData | undefined, nowMs: number) =>
	Predicate.isNumber(data?.expiresAt) && Number.isFinite(data.expiresAt) && data.expiresAt > nowMs;

const emailSignInActionCodeSettings = {
	url: "https://hccna.church/verify?",
	handleCodeInApp: true,
	iOS: {
		bundleId: "org.hccnj.app",
	},
	android: {
		packageName: "org.hccnj.app",
		installApp: true,
		minimumVersion: "12",
	},
} satisfies ActionCodeSettings;

const getEmailTemplateConfig = (type: EmailTemplateID) => emailTemplateConfig({ type });

const readFirebaseErrorCode = <Input>(value: Input): string | undefined => {
	if (!Predicate.isObject(value) || !Predicate.hasProperty(value, "code")) {
		return undefined;
	}

	const { code } = value;
	return Predicate.isString(code) ? code : undefined;
};

const getFirebaseErrorCode = (cause: unknown): string | undefined => {
	const directCode = readFirebaseErrorCode(cause);
	if (directCode) {
		return directCode;
	}

	if (!Predicate.isObject(cause) || !Predicate.hasProperty(cause, "cause")) {
		return undefined;
	}

	return readFirebaseErrorCode(cause.cause);
};

const isFirebaseUserNotFound = (cause: unknown) =>
	getFirebaseErrorCode(cause) === "auth/user-not-found";

const toFirebaseFetchError = (message: string) => (cause: unknown) =>
	new FirebaseFetchError({ message, cause });

const toAccountDeletionError = (message: string) => (cause: unknown) =>
	new AccountDeletionError({ message, cause });

const toGetUserByEmailError = (cause: unknown) =>
	isFirebaseUserNotFound(cause)
		? new UserNotFoundError({ message: "User not found" })
		: toFirebaseFetchError("Failed to get user")(cause);

const sendTemplateEmailEffect = Effect.fn("sendTemplateEmailEffect")(function* (
	data: MailDataRequired,
	message: string,
) {
	const mail = yield* MailService;

	yield* mail.send(data).pipe(
		Effect.catchTag("MailSendError", (error) =>
			Effect.fail(
				new EmailSendError({
					message,
					cause: error.cause ?? error,
				}),
			),
		),
	);
});

const sendSecurityAlertEmailEffect = Effect.fn("sendSecurityAlertEmailEffect")(function* (
	email: string,
	timestamp: string,
) {
	const emailData = {
		...getEmailTemplateConfig("TooManySignInAttempts"),
		to: email,
		substitutions: {
			attemptCount: MAX_FAILED_ATTEMPTS.toString(),
			timestamp,
		},
	} satisfies MailDataRequired;

	yield* sendTemplateEmailEffect(emailData, "Failed to send security alert email").pipe(
		Effect.catchTag("EmailSendError", (error) =>
			Effect.logError("Failed to send security alert email").pipe(
				Effect.annotateLogs({ error: error.message }),
			),
		),
	);
});

export const verifyCodeEffect = Effect.fn("verifyCodeEffect")(function* ({
	email,
	code,
	collection,
}: VerifyCodeInput) {
	const firebase = yield* FirebaseAdminService;
	const cache = firebase.db.collection(collection).doc(hashEmail(email));
	const now = yield* DateTime.now;
	const nowMs = DateTime.toEpochMillis(now);
	const outcome = yield* Effect.tryPromise({
		try: () =>
			firebase.db.runTransaction(async (transaction) => {
				const snapshot = await transaction.get(cache);
				if (!snapshot.exists) {
					return "invalid";
				}
				const data = snapshot.data();
				if (isLocked(data, nowMs)) {
					return "stillLocked";
				}
				if (!isUnexpired(data, nowMs)) {
					transaction.delete(cache);
					return "expired";
				}
				const failedAttempts = Predicate.isNumber(data?.failedAttempts) ? data.failedAttempts : 0;
				if (failedAttempts < MAX_FAILED_ATTEMPTS && data?.code === code) {
					transaction.delete(cache);
					return "valid";
				}
				// The last allowed failure locks at once. Waiting for one more attempt would let the
				// code expire unlocked, and the next code would start a fresh count.
				if (failedAttempts + 1 >= MAX_FAILED_ATTEMPTS) {
					// Replaces the document: the code is gone and only the lock remains.
					transaction.set(cache, { lockedUntil: nowMs + LOCKOUT_MS });
					return "locked";
				}
				transaction.update(cache, { failedAttempts: failedAttempts + 1 });
				return "invalid";
			}),
		catch: toFirebaseFetchError("Failed to verify code"),
	});
	// External side effects must run only after Firestore commits, since it can retry callbacks.
	if (outcome === "locked") {
		yield* sendSecurityAlertEmailEffect(
			email,
			DateTime.format(now, {
				dateStyle: "full",
				timeStyle: "long",
				locale: "en-US",
			}),
		);
	}
	if (outcome === "locked" || outcome === "stillLocked") {
		return yield* Effect.fail(new MaxAttemptsError({ message: LOCKED_MESSAGE }));
	}
	if (outcome === "expired") {
		return yield* Effect.fail(new CodeExpiredError({ message: "Code expired" }));
	}
	if (outcome === "invalid") {
		return yield* Effect.fail(new InvalidCodeError({ message: "Invalid code" }));
	}
});

const getUserByEmailEffect = Effect.fn("getUserByEmailEffect")(function* (
	email: string,
): Effect.fn.Return<UserRecord, UserNotFoundError | FirebaseFetchError, FirebaseAuthService> {
	const firebaseAuth = yield* FirebaseAuthService;

	return yield* firebaseAuth
		.getUserByEmail(email)
		.pipe(
			Effect.catchTag("FirebaseAuthError", (error) => Effect.fail(toGetUserByEmailError(error))),
		);
});

const getOrCreateUserEffect = Effect.fn("getOrCreateUserEffect")(function* (
	email: string,
): Effect.fn.Return<UserRecord, FirebaseFetchError, FirebaseAuthService> {
	const firebaseAuth = yield* FirebaseAuthService;
	const existingUser = yield* firebaseAuth.getUserByEmail(email).pipe(Effect.result);

	if (Result.isSuccess(existingUser)) {
		return existingUser.success;
	}

	if (!isFirebaseUserNotFound(existingUser.failure)) {
		return yield* Effect.fail(
			toFirebaseFetchError("Failed to get or create user")(existingUser.failure),
		);
	}

	return yield* firebaseAuth
		.createUser({ email, emailVerified: true })
		.pipe(
			Effect.catchTag("FirebaseAuthError", (error) =>
				Effect.fail(toFirebaseFetchError("Failed to get or create user")(error)),
			),
		);
});

const createCustomTokenEffect = Effect.fn("createCustomTokenEffect")(function* (
	uid: string,
): Effect.fn.Return<string, TokenCreationError, FirebaseAuthService> {
	const firebaseAuth = yield* FirebaseAuthService;

	return yield* firebaseAuth.createCustomToken(uid).pipe(
		Effect.catchTag("FirebaseAuthError", (error) =>
			Effect.fail(
				new TokenCreationError({
					message: "Failed to create custom token",
					cause: error.cause ?? error,
				}),
			),
		),
	);
});

export const generateEmailVerificationLinkEffect = Effect.fn("generateEmailVerificationLinkEffect")(
	function* (email: string) {
		const firebaseAuth = yield* FirebaseAuthService;
		const link = yield* firebaseAuth
			.generateSignInWithEmailLink(email, emailSignInActionCodeSettings)
			.pipe(
				Effect.catchTag("FirebaseAuthError", (error) =>
					Effect.fail(toFirebaseFetchError("Failed to create email verification link")(error)),
				),
			);
		const emailData = {
			...getEmailTemplateConfig("EmailSignIn"),
			to: email,
			subject: "Signin Link",
			substitutions: {
				link,
			},
		} satisfies MailDataRequired;

		yield* sendTemplateEmailEffect(emailData, "Failed to send email verification link");
		return link;
	},
);

export const generateAuthSignInCodeAndSendEmailEffect = Effect.fn(
	"generateAuthSignInCodeAndSendEmailEffect",
)(function* ({
	email,
	codeType,
}: GenerateAuthCodeInput): Effect.fn.Return<
	{ readonly code: string; readonly countDownTime: number },
	GenerateCodeError,
	FirebaseAdminService | MailService
> {
	const firebase = yield* FirebaseAdminService;
	const id = hashEmail(email);
	const collection =
		codeType === "auth" ? firebase.collections.signInCode : firebase.collections.deleteAccountCode;
	const cache = firebase.db.collection(collection).doc(id);
	const code = yield* Effect.sync(() => randomInt(100_000, 1_000_000).toString());
	const now = yield* DateTime.now;
	const nowMs = DateTime.toEpochMillis(now);
	const countDownTime = nowMs + CODE_EXPIRATION_MS;

	const issued = yield* Effect.tryPromise({
		try: () =>
			firebase.db.runTransaction(async (transaction) => {
				const previous = (await transaction.get(cache)).data();
				if (isLocked(previous, nowMs)) {
					return false;
				}
				// A code replaced before it expires hands its counted failures to the next one;
				// otherwise each new code would come with a fresh set of guesses.
				const failedAttempts =
					isUnexpired(previous, nowMs) && Predicate.isNumber(previous?.failedAttempts)
						? previous.failedAttempts
						: 0;
				// A replacement that inherits a spent count could never be verified, so it is not sent.
				if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
					transaction.set(cache, { lockedUntil: nowMs + LOCKOUT_MS });
					return false;
				}
				transaction.set(cache, { code, expiresAt: countDownTime, email, failedAttempts });
				return true;
			}),
		catch: toFirebaseFetchError("Failed to save verification code"),
	});
	if (!issued) {
		return yield* Effect.fail(new MaxAttemptsError({ message: LOCKED_MESSAGE }));
	}

	const emailData = {
		...getEmailTemplateConfig(codeType === "auth" ? "AuthSignInCode" : "DeleteSignInCode"),
		to: email,
		substitutions: {
			code,
			expiryMinutes: EXPIRATION_MINUTES.toString(),
		},
	} satisfies MailDataRequired;

	yield* sendTemplateEmailEffect(emailData, "Failed to send verification email");

	return {
		code,
		countDownTime,
	};
});

const verifyDeleteAccountCodeEffect = Effect.fn("verifyDeleteAccountCodeEffect")(function* ({
	email,
	code,
}: AuthCodeInput): Effect.fn.Return<
	{ readonly token: string; readonly user: UserRecord },
	VerifyCodeError | UserNotFoundError | TokenCreationError,
	FirebaseAdminService | FirebaseAuthService | MailService
> {
	const firebase = yield* FirebaseAdminService;

	yield* verifyCodeEffect({
		email,
		code,
		collection: firebase.collections.deleteAccountCode,
	});
	const user = yield* getUserByEmailEffect(email);
	const token = yield* createCustomTokenEffect(user.uid);
	return { token, user };
});

export const verifyAuthSignInCodeEffect = Effect.fn("verifyAuthSignInCodeEffect")(function* ({
	email,
	code,
}: AuthCodeInput): Effect.fn.Return<
	{ readonly token: string; readonly user: UserRecord },
	VerifyCodeError | TokenCreationError,
	FirebaseAdminService | FirebaseAuthService | MailService
> {
	const firebase = yield* FirebaseAdminService;

	yield* verifyCodeEffect({
		email,
		code,
		collection: firebase.collections.signInCode,
	});
	const user = yield* getOrCreateUserEffect(email);
	const token = yield* createCustomTokenEffect(user.uid);
	return { token, user };
});

const revokeRefreshTokensEffect = Effect.fn("revokeRefreshTokensEffect")(function* (uid: string) {
	const firebase = yield* FirebaseAdminService;

	yield* Effect.tryPromise({
		try: () => firebase.auth.revokeRefreshTokens(uid),
		catch: toAccountDeletionError("Failed to revoke refresh tokens"),
	});
});

const deleteUserEffect = Effect.fn("deleteUserEffect")(function* (uid: string) {
	const firebase = yield* FirebaseAdminService;

	yield* Effect.tryPromise({
		try: () => firebase.auth.deleteUser(uid),
		catch: toAccountDeletionError("Failed to delete user account"),
	});
});

export const deleteUserPostgresEffect = Effect.fn("deleteUserPostgresEffect")(function* (
	uid: string,
) {
	const { db } = yield* DrizzleService;

	// Child rows (donations, memberships, subscriptions) are removed by their
	// onDelete: "cascade" FKs. Donation history is only a cache of CCB, which
	// remains the system of record, so nothing authoritative is lost.
	const deleted = yield* Effect.tryPromise({
		try: () =>
			db
				.delete(users)
				.where(eq(users.firebaseUid, uid))
				.returning({ id: users.id, email: users.email }),
		catch: toAccountDeletionError("Failed to delete user from Postgres"),
	});

	const profiles = yield* ProfileService;
	yield* profiles.clearCache({ firebaseUid: uid, ...deleted[0] });

	if (deleted.length === 0) {
		// Legacy accounts may predate Postgres provisioning; nothing to delete.
		yield* Effect.log("No Postgres row found for deleted account", { uid });
	}
});

// A failure after the Postgres row is gone leaves the account partially
// deleted (Firestore doc and/or auth user remain). Record uid and stage so
// these accounts can be found and reconciled; the error still propagates.
const logPartialDeletion = (uid: string, stage: "firestore" | "auth") => (cause: unknown) =>
	Effect.logError("Account deletion left partial state", { uid, stage, error: cause });

export const deleteAccountEffect = Effect.fn("deleteAccountEffect")(function* ({
	email,
	code,
}: AuthCodeInput): Effect.fn.Return<
	void,
	VerifyCodeError | UserNotFoundError | TokenCreationError | AccountDeletionError,
	DrizzleService | FirebaseAdminService | FirebaseAuthService | MailService | ProfileService
> {
	const { user } = yield* verifyDeleteAccountCodeEffect({ email, code });
	// Keep the session usable if database cleanup fails, so deletion can be
	// retried with a new code. Later failures can leave partially deleted data;
	// after revocation the user must reauthenticate before retrying.
	yield* deleteUserPostgresEffect(user.uid);
	yield* deleteUserFireStoreEffect(user.uid).pipe(
		Effect.tapError(logPartialDeletion(user.uid, "firestore")),
	);
	yield* revokeRefreshTokensEffect(user.uid).pipe(
		Effect.tapError(logPartialDeletion(user.uid, "auth")),
	);
	yield* deleteUserEffect(user.uid).pipe(Effect.tapError(logPartialDeletion(user.uid, "auth")));
});

export const deleteUserFireStoreEffect = Effect.fn("deleteUserFireStoreEffect")(function* (
	uid: string,
) {
	const firebase = yield* FirebaseAdminService;
	const userDoc = firebase.db.collection(firebase.collections.users).doc(uid);

	// recursiveDelete removes subcollections too and is a no-op when the doc is
	// already gone (e.g. the auth onDelete trigger got there first).
	yield* Effect.tryPromise({
		try: () => firebase.db.recursiveDelete(userDoc),
		catch: toAccountDeletionError("Failed to delete user from Firestore"),
	});
});

export const createVerifyAndCleanupEffect = Effect.fn("createVerifyAndCleanupEffect")(function* <
	R,
>({
	email,
	uid,
	getUserByEmail,
	deleteUserFireStore,
}: CreateVerifyAndCleanupInput<R>): Effect.fn.Return<CleanupResult, AccountDeletionError, R> {
	const userResult = yield* Effect.tryPromise({
		try: () => getUserByEmail(email),
		catch: (error) => ({
			code: getFirebaseErrorCode(error),
			originalError: error,
		}),
	}).pipe(Effect.result);

	if (Result.isSuccess(userResult)) {
		return {
			success: false,
			message: "Auth account still exists; cannot proceed with cleanup",
		};
	}

	if (userResult.failure.code !== "auth/user-not-found") {
		return yield* Effect.fail(
			new AccountDeletionError({
				message: `Failed to verify user deletion: ${userResult.failure.code ?? "unknown error"}`,
				cause: userResult.failure.originalError,
			}),
		);
	}

	yield* deleteUserFireStore(uid);
	return { success: true, message: "done successfully" };
});
