import { FirebaseAuthService } from "@/effect/services/FirebaseAuthService";
import { OnboardingProfileStore } from "@/services/onboarding/onboardingProfileStore";
import { OnboardingQueue } from "@/services/onboarding/onboardingQueue";
import {
	hasPlaceholderName,
	isIncompleteProfile,
	needsCcbProfileRefresh,
} from "@/services/onboarding/profileRefresh";
import {
	buildOnboardingUserDoc,
	findFirestoreUserByEmailEffect,
	findPostgresUserByEmailEffect,
	getPostgresUserByUidEffect,
	getUserByIdEffect,
	type OnboardingPayload,
	type UserDoc,
	type StoredUserDoc,
} from "@/services/onboarding/userProvisioning";
import { omitUndefined } from "@/utils/omitUndefined";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import type { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import type { DrizzleService } from "@/effect/services/DrizzleService";

export interface EnsureUserProfileInput {
	uid: string;
	email: string;
}

export interface EnsureUserProfileSuccess {
	readonly _tag: "EnsureUserProfileSuccess";
	readonly created: boolean;
	readonly repaired: boolean;
	readonly enrichmentPending: boolean;
	readonly message: string;
}

export class EnsureUserProfileRetryableError extends Schema.TaggedError<EnsureUserProfileRetryableError>()(
	"EnsureUserProfileRetryableError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {}

class EnsureUserProfileIdentityConflictError extends Schema.TaggedError<EnsureUserProfileIdentityConflictError>()(
	"EnsureUserProfileIdentityConflictError",
	{
		message: Schema.String,
		uid: Schema.String,
		conflictingUid: Schema.String,
	},
) {}

export type EnsureUserProfileError =
	| EnsureUserProfileRetryableError
	| EnsureUserProfileIdentityConflictError;

export type EnsureUserProfileResult = EnsureUserProfileSuccess | EnsureUserProfileError;

interface PostgresUserProfile {
	readonly firebaseUid: string;
	readonly email: string;
	readonly firstName?: string | null;
	readonly lastName?: string | null;
	readonly phone?: string | null;
	readonly img?: string | null;
	readonly isVerified?: boolean | null;
	readonly ccbId?: string | null;
	readonly ccbFamilyId?: string | null;
	readonly provider?: string | null;
	readonly createdAt?: Date | null;
	readonly enrichmentPending?: boolean;
	readonly ccbProfileCheckedAt?: Date | null;
}

export interface FirebaseUserProfile {
	readonly uid: string;
	readonly emailVerified: boolean;
	readonly displayName?: string;
	readonly photoURL?: string;
	readonly phoneNumber?: string;
	readonly providerData: readonly { readonly providerId: string }[];
	readonly metadata: { readonly creationTime?: string };
}

interface DualWriteResult {
	readonly firestoreSuccess: boolean;
	readonly postgresSuccess: boolean;
}

export interface EnsureUserProfileDeps {
	loadFirestoreUser: (uid: string) => Effect.Effect<StoredUserDoc | undefined, unknown>;
	loadPostgresUser: (uid: string) => Effect.Effect<PostgresUserProfile | null, unknown>;
	findPostgresUserByEmail: (email: string) => Effect.Effect<PostgresUserProfile | null, unknown>;
	findFirestoreUserByEmail: (
		email: string,
	) => Effect.Effect<{ readonly uid: string } | null, unknown>;
	getAuthUser: (uid: string) => Effect.Effect<FirebaseUserProfile, unknown>;
	persistUserDoc: (user: UserDoc) => Effect.Effect<DualWriteResult, unknown>;
	enqueueEnrichment: (input: EnsureUserProfileInput) => Effect.Effect<void, unknown>;
	enqueueRefresh: (input: EnsureUserProfileInput) => Effect.Effect<void, unknown>;
}

const success = (values: Omit<EnsureUserProfileSuccess, "_tag">): EnsureUserProfileSuccess => ({
	_tag: "EnsureUserProfileSuccess",
	...values,
});

const retryable = (message: string, cause?: unknown) =>
	new EnsureUserProfileRetryableError({ message, cause });

const completedWrite = (result: DualWriteResult) =>
	result.firestoreSuccess && result.postgresSuccess;

export function toOnboardingPayload(record: FirebaseUserProfile, email: string): OnboardingPayload {
	const displayName = record.displayName?.trim();
	const nameParts = displayName ? displayName.split(/\s+/u) : [];

	return omitUndefined({
		email,
		uid: record.uid,
		img: record.photoURL ?? undefined,
		isVerified: record.emailVerified,
		firstName: nameParts[0],
		lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
		phone: record.phoneNumber ?? undefined,
		provider: record.providerData[0]?.providerId,
		createdAt: record.metadata.creationTime ?? undefined,
	});
}

function userDocFromPostgresRow(row: PostgresUserProfile): UserDoc {
	return omitUndefined({
		email: row.email,
		uid: row.firebaseUid,
		firstName: row.firstName || undefined,
		lastName: row.lastName || undefined,
		phone: row.phone || undefined,
		img: row.img || undefined,
		isVerified: row.isVerified ?? false,
		ccbId: row.ccbId || undefined,
		ccbFamilyId: row.ccbFamilyId || undefined,
		provider: row.provider || undefined,
		createdAt: row.createdAt?.toISOString(),
	});
}

export function userDocFromFirestoreDoc(
	doc: StoredUserDoc,
	input: EnsureUserProfileInput,
): UserDoc {
	return {
		...doc,
		email: input.email,
		uid: input.uid,
		isVerified: doc.isVerified ?? false,
	};
}

export const createEnsureUserProfileEffect = (deps: EnsureUserProfileDeps) => {
	const persist = Effect.fnUntraced(function* (user: UserDoc, failureMessage: string) {
		const write = yield* Effect.result(deps.persistUserDoc(user));
		if (write._tag === "Failure") {
			return yield* retryable(failureMessage, write.failure);
		}
		if (!completedWrite(write.success)) {
			return yield* retryable(failureMessage);
		}
	});

	return Effect.fn("EnsureUserProfile.reconcile")(function* (input: EnsureUserProfileInput) {
		const [firestoreResult, postgresResult] = yield* Effect.all(
			[
				Effect.result(deps.loadFirestoreUser(input.uid)),
				Effect.result(deps.loadPostgresUser(input.uid)),
			],
			{ concurrency: 2 },
		);

		if (firestoreResult._tag === "Failure") {
			yield* Effect.logError("ensureUserProfile store read failed").pipe(
				Effect.annotateLogs({ uid: input.uid }),
			);
			return yield* retryable("Failed to check existing profile", firestoreResult.failure);
		}

		if (postgresResult._tag === "Failure") {
			yield* Effect.logError("ensureUserProfile store read failed").pipe(
				Effect.annotateLogs({ uid: input.uid }),
			);
			return yield* retryable("Failed to check existing profile", postgresResult.failure);
		}

		const firestoreDoc = firestoreResult.success ?? null;
		const postgresRow = postgresResult.success;

		if (firestoreDoc && postgresRow) {
			const incomplete =
				firestoreDoc.ccbEnrichmentPending === true ||
				hasPlaceholderName(firestoreDoc) ||
				isIncompleteProfile(postgresRow);
			if (needsCcbProfileRefresh(postgresRow, yield* Clock.currentTimeMillis, incomplete)) {
				if (incomplete) {
					// A repair must be durably queued before reporting success, so the client retries.
					yield* deps
						.enqueueEnrichment(input)
						.pipe(
							Effect.mapError((cause) => retryable("Failed to schedule profile enrichment", cause)),
						);
				} else {
					// A routine check of a complete profile must not fail sign-in; the next profile
					// read queues it again.
					yield* deps.enqueueRefresh(input).pipe(
						Effect.timeout("5 seconds"),
						Effect.catch((error) =>
							Effect.logWarning("Failed to enqueue CCB profile refresh", { uid: input.uid, error }),
						),
					);
				}
			}
			return success({
				created: false,
				repaired: false,
				enrichmentPending: firestoreDoc.ccbEnrichmentPending === true,
				message: "Profile already exists",
			});
		}

		if (firestoreDoc && !postgresRow) {
			yield* persist(userDocFromFirestoreDoc(firestoreDoc, input), "Failed to repair profile");
			return success({
				created: false,
				repaired: true,
				enrichmentPending: false,
				message: "Profile repaired",
			});
		}

		if (!firestoreDoc && postgresRow) {
			yield* persist(
				{
					...userDocFromPostgresRow(postgresRow),
					ccbEnrichmentPending: true,
				},
				"Failed to repair profile",
			);
			return success({
				created: false,
				repaired: true,
				enrichmentPending: true,
				message: "Profile repaired; directory enrichment pending",
			});
		}

		const [postgresConflict, firestoreConflict] = yield* Effect.all(
			[
				Effect.result(deps.findPostgresUserByEmail(input.email)),
				Effect.result(deps.findFirestoreUserByEmail(input.email)),
			],
			{ concurrency: 2 },
		);
		if (postgresConflict._tag === "Failure") {
			return yield* retryable("Failed to check existing profile", postgresConflict.failure);
		}
		if (firestoreConflict._tag === "Failure") {
			return yield* retryable("Failed to check existing profile", firestoreConflict.failure);
		}

		let conflictingUid: string | null = null;
		if (postgresConflict.success && postgresConflict.success.firebaseUid !== input.uid) {
			conflictingUid = postgresConflict.success.firebaseUid;
		} else if (firestoreConflict.success && firestoreConflict.success.uid !== input.uid) {
			conflictingUid = firestoreConflict.success.uid;
		}
		if (conflictingUid) {
			yield* Effect.logError("ensureUserProfile identity conflict").pipe(
				Effect.annotateLogs({
					uid: input.uid,
					conflictingUid,
				}),
			);
			return yield* new EnsureUserProfileIdentityConflictError({
				message: "Email is already linked to a different account",
				uid: input.uid,
				conflictingUid,
			});
		}

		const authUser = yield* Effect.result(deps.getAuthUser(input.uid));
		if (authUser._tag === "Failure") {
			return yield* retryable("Failed to load auth user", authUser.failure);
		}

		// Directory calls run in the durable worker after the base profile exists.
		const userDoc: UserDoc = {
			...buildOnboardingUserDoc(toOnboardingPayload(authUser.success, input.email), null),
			ccbEnrichmentPending: true,
		};
		yield* persist(userDoc, "Failed to create user profile");

		return success({
			created: true,
			repaired: false,
			enrichmentPending: true,
			message: "User created; directory enrichment pending",
		});
	});
};

export class UserProfileProvisioningService extends Context.Service<
	UserProfileProvisioningService,
	{
		ensure: (
			input: EnsureUserProfileInput,
		) => Effect.Effect<EnsureUserProfileSuccess, EnsureUserProfileError>;
	}
>()("@hccnj/server/onboarding/UserProfileProvisioningService", {
	make: Effect.gen(function* () {
		const context = yield* Effect.context<FirebaseAdminContext | DrizzleService>();
		const provide = Effect.provide(context);
		const auth = yield* FirebaseAuthService;
		const store = yield* OnboardingProfileStore;
		const queue = yield* OnboardingQueue;
		return {
			ensure: createEnsureUserProfileEffect({
				loadFirestoreUser: (uid) => getUserByIdEffect(uid).pipe(provide),
				loadPostgresUser: (uid) => getPostgresUserByUidEffect(uid).pipe(provide),
				findPostgresUserByEmail: (email) => findPostgresUserByEmailEffect(email).pipe(provide),
				findFirestoreUserByEmail: (email) => findFirestoreUserByEmailEffect(email).pipe(provide),
				getAuthUser: (uid) => auth.getUser(uid),
				persistUserDoc: store.ensure,
				enqueueEnrichment: queue.enqueue,
				enqueueRefresh: queue.enqueueRefresh,
			}),
		};
	}),
}) {}

export const UserProfileProvisioningServiceLive = Layer.effect(
	UserProfileProvisioningService,
	UserProfileProvisioningService.make,
);

export const ensureUserProfileEffect = Effect.fn("UserProfileProvisioning.ensure")(function* (
	input: EnsureUserProfileInput,
) {
	const service = yield* UserProfileProvisioningService;
	return yield* service.ensure(input);
});
