import { users } from "@/db/schema/users";
import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import { CCBService } from "@/effect/services/CCBService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { getDepartmentsEffect, getMinistriesEffect } from "@/services/publicApi/departmentsService";
import { AppCollections } from "@/utils/firebase";
import { omitUndefined } from "@/utils/omitUndefined";
import { eq } from "drizzle-orm";
import { Effect, Predicate, Schema } from "effect";

import type { OnboardingJob } from "@/services/onboarding/onboardingQueue";

/**
 * Fetch onboarding profile data and enrich it with CCB groups when available.
 */
export const getOnboardingProfileEffect = (email: string) =>
	Effect.gen(function* () {
		const ccb = yield* CCBService;

		const [ccbUser, groups, ministries] = yield* Effect.all(
			[
				ccb.searchUserByEmail(email, { skipCache: true }),
				getDepartmentsEffect,
				getMinistriesEffect,
			],
			{ concurrency: 3 },
		);

		const candidates = ccbUser.individuals?.individual;
		if (
			ccbUser.individuals?.count === "0" ||
			(Array.isArray(candidates) && candidates.length === 0)
		) {
			return { email, departments: [], ministries: [] };
		}
		const individual = Array.isArray(candidates)
			? candidates.find((item) => item.login === email)
			: candidates;

		if (!individual?.id) {
			return null;
		}

		const ccbUserDetails = yield* ccb.getUserGroupsById(Number(individual.id), { skipCache: true });
		const departments = groups.filter((group: any) =>
			ccbUserDetails.individuals?.individual?.groups?.group?.find(
				(item: any) => Number(item.group_id) === Number(group.ccbId),
			),
		);
		const myMinistries = ministries.filter((ministry: any) =>
			ccbUserDetails.individuals?.individual?.groups?.group?.find(
				(item: any) => Number(item.group_id) === Number(ministry.ccbId),
			),
		);

		return {
			email,
			ccbId: individual.id || null,
			firstName: individual.first_name,
			lastName: individual.last_name,
			phone: individual.phones?.phone?.[0]?.text,
			ccbFamilyId: individual.family?.id,
			// Empty lists clear departed memberships. Ambiguous shared-email results return
			// null above, preserving existing groups until we can identify the member.
			departments,
			ministries: myMinistries,
		};
	});

export interface OnboardingProfile {
	email: string;
	ccbId?: string | null;
	firstName?: string;
	lastName?: string;
	phone?: string;
	ccbFamilyId?: string;
	departments?: UserDoc["departments"];
	ministries?: {
		id: number;
		slug: string;
		ccbId: string;
		name: string;
		image: string;
		description: string;
		link: string;
	}[];
}

export interface UserDoc {
	email: string;
	uid: string;
	firstName?: string;
	lastName?: string;
	departments?: {
		id: number;
		slug: string;
		ccbId: string;
		name: string;
		image: string;
		description: string;
		link: string;
		fullName: string;
	}[];
	ministries?: {
		id: number;
		slug: string;
		ccbId: string;
		name: string;
		image: string;
		fullName: string;
		description: string;
		link: string;
	}[];
	ccbId?: string;
	ccbFamilyId?: string;
	img?: string | null;
	isVerified: boolean;
	phone?: string | null;
	userMetadata?: unknown;
	provider?: string | null;
	createdAt?: string | null;
	/** Set when directory enrichment needs to be retried by the backfill. */
	ccbEnrichmentPending?: boolean;
}

interface FirestoreAuditUser {
	uid: string;
	email: string | null;
	ccbEnrichmentPending?: boolean;
}

export interface OnboardingPayload {
	email: string;
	uid: string;
	img?: string | null | undefined;
	isVerified?: boolean | null | undefined;
	firstName?: string | null | undefined;
	lastName?: string | null | undefined;
	phone?: unknown;
	userMetadata?: unknown;
	provider?: string | null | undefined;
	createdAt?: string | null | undefined;
}

class FirestoreReadError extends Error {
	readonly _tag = "FirestoreReadError";
	override readonly name = "FirestoreReadError";
	constructor(
		message: string,
		// oxlint-disable-next-line typescript/parameter-properties
		override readonly cause?: unknown,
	) {
		super(message);
	}
}

class PostgresReadError extends Error {
	readonly _tag = "PostgresReadError";
	override readonly name = "PostgresReadError";
	constructor(
		message: string,
		// oxlint-disable-next-line typescript/parameter-properties
		override readonly cause?: unknown,
	) {
		super(message);
	}
}

export type StoredUserDoc = Omit<Partial<UserDoc>, "email"> & { email?: string | null };

export const getUserByIdEffect = (uid: string) =>
	Effect.gen(function* () {
		const { db } = yield* FirebaseAdminContext;
		const userRef = db.collection(AppCollections.users).doc(uid);
		const userDoc = yield* Effect.tryPromise({
			try: () => userRef.get(),
			catch: (cause) => new FirestoreReadError("Failed to fetch user from Firestore", cause),
		});

		if (!userDoc.exists) {
			return;
		}

		const userData = userDoc.data() as StoredUserDoc;

		const { ministries: _, ...rest } = userData;
		return { ...rest, uid };
	});

export const getPostgresUserByUidEffect = (uid: string) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		const rows = yield* Effect.tryPromise({
			try: () => db.select().from(users).where(eq(users.firebaseUid, uid)).limit(1),
			catch: (cause) => new PostgresReadError("Failed to read user from Postgres", cause),
		});
		return rows[0] ?? null;
	});

export const findPostgresUserByEmailEffect = (email: string) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		const rows = yield* Effect.tryPromise({
			try: () => db.select().from(users).where(eq(users.email, email)).limit(1),
			catch: (cause) => new PostgresReadError("Failed to read user from Postgres", cause),
		});
		return rows[0] ?? null;
	});

// Audit-scan adapters for the Phase-3 reconciliation tooling. The Firestore
// scan projects only the fields the audit needs; doc ids are the owning uids.
export const listFirestoreUsersEffect = Effect.gen(function* () {
	const { db } = yield* FirebaseAdminContext;
	const snapshot = yield* Effect.tryPromise({
		try: () => db.collection(AppCollections.users).select("email", "ccbEnrichmentPending").get(),
		catch: (cause) => new FirestoreReadError("Failed to list users from Firestore", cause),
	});
	return snapshot.docs.map((document) => {
		const data = document.data() as { email?: string | null; ccbEnrichmentPending?: boolean };
		const user: FirestoreAuditUser = {
			uid: document.id,
			email: data.email ?? null,
		};
		if (data.ccbEnrichmentPending === true) {
			user.ccbEnrichmentPending = true;
		}
		return user;
	});
});

export const listPostgresUsersEffect = Effect.gen(function* () {
	const { db } = yield* DrizzleService;
	return yield* Effect.tryPromise({
		try: () => db.select({ firebaseUid: users.firebaseUid, email: users.email }).from(users),
		catch: (cause) => new PostgresReadError("Failed to list users from Postgres", cause),
	});
});

export const findFirestoreUserByEmailEffect = Effect.fn(
	"UserProvisioning.findFirestoreUserByEmail",
)(function* (email: string) {
	const { db } = yield* FirebaseAdminContext;
	const snapshot = yield* Effect.tryPromise({
		try: () => db.collection(AppCollections.users).where("email", "==", email).limit(1).get(),
		catch: (cause) => new FirestoreReadError("Failed to query user by email", cause),
	});
	const [document] = snapshot.docs;
	return document ? { uid: document.id } : null;
});

/** Names buildOnboardingUserDoc falls back to when no data source had one. */
export const FALLBACK_NAMES: ReadonlySet<string> = new Set(["Hi", "There", "Anonymous"]);

/**
 * Profile image used when neither the auth record nor the directory has one
 * (Apple sign-ins never carry a photoURL). Same asset the mobile avatar treats
 * as "no photo"; the Firestore-backed profile loader rejects documents without
 * `img`.
 */
const DEFAULT_PROFILE_IMAGE =
	"https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fhcclogov2base.png?alt=media&token=40fc509b-0d90-431c-9f32-437d566edf6c";

function normalizePhoneValue<Input>(value: Input): string | null | undefined {
	if (Predicate.isString(value)) {
		return value;
	}
	if (Predicate.isNumber(value) || Predicate.isBoolean(value)) {
		return String(value);
	}
	return undefined;
}

/**
 * Build the persisted onboarding user record from auth payload and CCB enrichment.
 */
export function buildOnboardingUserDoc(
	input: OnboardingPayload,
	user: OnboardingProfile | null,
): UserDoc {
	const {
		email,
		uid,
		img,
		isVerified,
		firstName,
		lastName,
		phone,
		userMetadata,
		provider,
		createdAt,
	} = input;
	const resolvedPhone = normalizePhoneValue(phone) || user?.phone;

	return omitUndefined({
		// Prefer directory data first, then auth payload, then anonymous fallbacks.
		email,
		firstName: user?.firstName ?? firstName ?? (provider === "google.com" ? "Hi" : "Anonymous"),
		lastName: user?.lastName ?? lastName ?? (provider === "google.com" ? "There" : "Anonymous"),
		uid,
		...(user?.departments && {
			departments: user.departments.map((department) => department),
		}),
		...(user?.ministries && {
			ministries: user.ministries.map((ministry) => ({
				...ministry,
				fullName: ministry.name,
			})),
		}),
		ccbId: user?.ccbId || undefined,
		ccbFamilyId: user?.ccbFamilyId || undefined,
		img: img || DEFAULT_PROFILE_IMAGE,
		isVerified: isVerified || false,
		phone: resolvedPhone || undefined,
		userMetadata: userMetadata || undefined,
		provider: provider || undefined,
		createdAt: createdAt || undefined,
	});
}

/** Only background-owned fields are written; current user edits win. */
export function enrichmentPatch(doc: StoredUserDoc, profile: OnboardingProfile) {
	const firstName =
		!doc.firstName || FALLBACK_NAMES.has(doc.firstName) ? profile.firstName : undefined;
	const lastName = !doc.lastName || FALLBACK_NAMES.has(doc.lastName) ? profile.lastName : undefined;
	return omitUndefined({
		firstName,
		lastName,
		phone: doc.phone ? undefined : profile.phone,
		ccbId: doc.ccbId ? undefined : (profile.ccbId ?? undefined),
		ccbFamilyId: doc.ccbFamilyId ? undefined : profile.ccbFamilyId,
		departments: profile.departments,
		ministries: profile.ministries?.map((ministry) => ({ ...ministry, fullName: ministry.name })),
		ccbEnrichmentPending: false,
	});
}

class FirestoreOnboardingWriteError extends Schema.TaggedError<FirestoreOnboardingWriteError>()(
	"FirestoreOnboardingWriteError",
	{
		message: Schema.String,
		cause: Schema.Unknown,
	},
) {}

export const createFirestoreOnboardingDocEffect = Effect.fn("UserProvisioning.createFirestoreDoc")(
	function* (doc: UserDoc) {
		const { db } = yield* FirebaseAdminContext;
		yield* Effect.tryPromise({
			try: () =>
				db.runTransaction(async (transaction) => {
					const ref = db.collection(AppCollections.users).doc(doc.uid);
					const snapshot = await transaction.get(ref);
					if (!snapshot.exists) {
						transaction.create(ref, doc);
						return;
					}
					const stored = snapshot.data() as StoredUserDoc;
					if (stored.email && stored.email !== doc.email) {
						throw new FirestoreOnboardingWriteError({
							message: "Firestore profile identity changed",
							cause: doc.uid,
						});
					}
				}),
			catch: (cause) =>
				new FirestoreOnboardingWriteError({ message: "Failed to create Firestore profile", cause }),
		});
	},
);

export const enrichFirestoreOnboardingDocEffect = Effect.fn("UserProvisioning.enrichFirestoreDoc")(
	function* (job: OnboardingJob, profile: OnboardingProfile) {
		const { db } = yield* FirebaseAdminContext;
		yield* Effect.tryPromise({
			try: () =>
				db.runTransaction(async (transaction) => {
					const ref = db.collection(AppCollections.users).doc(job.uid);
					const snapshot = await transaction.get(ref);
					if (!snapshot.exists) {
						return;
					}
					const doc = snapshot.data() as StoredUserDoc;
					if (doc.email && doc.email !== job.email) {
						return;
					}
					transaction.update(ref, enrichmentPatch(doc, profile));
				}),
			catch: (cause) =>
				new FirestoreOnboardingWriteError({ message: "Failed to enrich Firestore profile", cause }),
		});
	},
);
