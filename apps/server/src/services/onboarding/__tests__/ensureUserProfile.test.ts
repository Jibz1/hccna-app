import { omitUndefined } from "@/utils/omitUndefined";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import type { UserRecord } from "firebase-admin/auth";

void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	auth: {},
	db: {},
	secondaryDb: {},
	dbFieldValue: {},
	fieldPath: {},
	FBPaths: {},
	getStorageBucket: mock(),
	AppCollections: {
		users: "app-users",
		signInCode: "sign-in-code",
		deleteAccountCode: "delete-account-code",
	},
}));

void mock.module("@/redis", () => ({
	redis: { get: mock(), set: mock(), mget: mock(), expire: mock() },
}));

const { createEnsureUserProfileEffect, toOnboardingPayload, userDocFromFirestoreDoc } =
	await import("../ensureUserProfile");

type UserRecordOverrideKey = "displayName" | "email" | "phoneNumber" | "photoURL";

type UserRecordOverrides = {
	[K in UserRecordOverrideKey]?: UserRecord[K] | undefined;
} & { providerData?: UserRecord["providerData"] };

const record = (overrides: UserRecordOverrides = {}): UserRecord =>
	omitUndefined({
		uid: "uid-1",
		email: "ada@example.com",
		emailVerified: true,
		displayName: "Ada King Lovelace",
		photoURL: "https://img.example/a.png",
		phoneNumber: "+15550001111",
		disabled: false,
		providerData: [
			{
				providerId: "google.com",
				uid: "google-uid-1",
				displayName: "Ada King Lovelace",
				email: "ada@example.com",
				photoURL: "https://img.example/a.png",
				phoneNumber: "+15550001111",
				toJSON: () => ({ providerId: "google.com" }),
			},
		],
		metadata: {
			creationTime: "2026-07-11T00:00:00Z",
			lastSignInTime: "2026-07-11T00:00:00Z",
			toJSON: () => ({ creationTime: "2026-07-11T00:00:00Z" }),
		},
		toJSON: () => ({ uid: "uid-1" }),
		...overrides,
	});

const dayMs = 24 * 60 * 60 * 1000;

const pgRow = {
	firebaseUid: "uid-1",
	email: "ada@example.com",
	firstName: "Ada",
	lastName: "Lovelace",
	phone: "+15550001111",
	img: null,
	isVerified: true,
	ccbId: "42",
	ccbFamilyId: "7",
	provider: "google.com",
	createdAt: new Date("2026-07-11T00:00:00Z"),
	ccbProfileCheckedAt: new Date(),
};

describe("toOnboardingPayload", () => {
	it("uses the verified context email instead of the auth record email", () => {
		const payload = toOnboardingPayload(record({ email: "stale@example.com" }), "ada@example.com");
		expect(payload.email).toBe("ada@example.com");
	});
});

describe("profile mappers", () => {
	it("forces Firestore identity fields to match the authenticated caller", () => {
		const doc = userDocFromFirestoreDoc(
			{ uid: "spoofed", email: "spoofed@example.com", firstName: "Ada", isVerified: true },
			{ uid: "uid-1", email: "ada@example.com" },
		);
		expect(doc.uid).toBe("uid-1");
		expect(doc.email).toBe("ada@example.com");
		expect(doc.firstName).toBe("Ada");
	});
});

describe("createEnsureUserProfileEffect", () => {
	const input = { uid: "uid-1", email: "ada@example.com" };
	const loadFirestoreUser = mock();
	const loadPostgresUser = mock();
	const findPostgresUserByEmail = mock();
	const findFirestoreUserByEmail = mock();
	const getAuthUser = mock();
	const enqueueEnrichment = mock();
	const enqueueRefresh = mock();
	const persistUserDoc = mock();

	const ensure = () =>
		createEnsureUserProfileEffect({
			loadFirestoreUser,
			loadPostgresUser,
			findPostgresUserByEmail,
			findFirestoreUserByEmail,
			getAuthUser,
			enqueueEnrichment,
			enqueueRefresh,
			persistUserDoc,
		})(input);

	const run = () => Effect.runPromise(Effect.result(ensure()));

	const runSuccess = async () => {
		const result = await run();
		if (result._tag === "Failure") {
			throw result.failure;
		}
		return result.success;
	};

	const runFailure = async () => {
		const result = await run();
		if (result._tag === "Success") {
			throw new Error("Expected reconciliation to fail");
		}
		return result.failure;
	};

	beforeEach(() => {
		for (const dependency of [
			loadFirestoreUser,
			loadPostgresUser,
			findPostgresUserByEmail,
			findFirestoreUserByEmail,
			getAuthUser,
			enqueueEnrichment,
			enqueueRefresh,
			persistUserDoc,
		]) {
			dependency.mockClear();
		}
		loadFirestoreUser.mockReturnValue(Effect.void);
		loadPostgresUser.mockReturnValue(Effect.succeed(null));
		findPostgresUserByEmail.mockReturnValue(Effect.succeed(null));
		findFirestoreUserByEmail.mockReturnValue(Effect.succeed(null));
		getAuthUser.mockReturnValue(Effect.succeed(record()));
		enqueueEnrichment.mockReturnValue(Effect.void);
		enqueueRefresh.mockReturnValue(Effect.void);
		persistUserDoc.mockReturnValue(
			Effect.succeed({ firestoreSuccess: true, postgresSuccess: true }),
		);
	});

	it("returns READY without writing when both stores contain the profile", async () => {
		loadFirestoreUser.mockReturnValue(
			Effect.succeed({ uid: "uid-1", email: "ada@example.com", isVerified: true }),
		);
		loadPostgresUser.mockReturnValue(Effect.succeed(pgRow));

		expect(await runSuccess()).toEqual({
			_tag: "EnsureUserProfileSuccess",
			created: false,
			repaired: false,
			enrichmentPending: false,
			message: "Profile already exists",
		});
		expect(persistUserDoc).not.toHaveBeenCalled();
		expect(enqueueEnrichment).not.toHaveBeenCalled();
		expect(enqueueRefresh).not.toHaveBeenCalled();
	});

	it.each([null, new Date("2026-01-01T00:00:00Z")])(
		"queues a weekly CCB check on the refresh queue for a profile last checked at %s",
		async (ccbProfileCheckedAt) => {
			loadFirestoreUser.mockReturnValue(
				Effect.succeed({ ...input, firstName: "Ada", lastName: "Lovelace" }),
			);
			loadPostgresUser.mockReturnValue(Effect.succeed({ ...pgRow, ccbProfileCheckedAt }));
			expect(await runSuccess()).toMatchObject({ created: false, enrichmentPending: false });
			expect(enqueueRefresh).toHaveBeenCalledWith(input);
			expect(enqueueEnrichment).not.toHaveBeenCalled();
			expect(persistUserDoc).not.toHaveBeenCalled();
		},
	);

	it("backfills Postgres from a Firestore-only profile", async () => {
		loadFirestoreUser.mockReturnValue(
			Effect.succeed({
				uid: "uid-1",
				email: "ada@example.com",
				firstName: "Ada",
				ccbId: "42",
				isVerified: true,
			}),
		);

		const result = await runSuccess();
		expect(result.repaired).toBe(true);
		expect(result.enrichmentPending).toBe(false);
		expect(persistUserDoc.mock.calls[0]?.[0]).toMatchObject({ firstName: "Ada", ccbId: "42" });
	});

	it("creates the base profile with directory enrichment pending", async () => {
		const result = await runSuccess();
		expect(result).toMatchObject({ created: true, enrichmentPending: true });
		expect(persistUserDoc.mock.calls[0]?.[0]).toMatchObject({
			firstName: "Ada",
			lastName: "King Lovelace",
			ccbEnrichmentPending: true,
		});
	});

	it("fails closed when either store read fails", async () => {
		loadFirestoreUser.mockReturnValue(Effect.fail(new Error("firestore down")));

		const result = await runFailure();
		expect(result._tag).toBe("EnsureUserProfileRetryableError");
		expect(persistUserDoc).not.toHaveBeenCalled();
	});

	it("rejects an email owned by another Firebase uid", async () => {
		findPostgresUserByEmail.mockReturnValue(Effect.succeed({ ...pgRow, firebaseUid: "other-uid" }));

		const result = await runFailure();
		expect(result).toMatchObject({
			_tag: "EnsureUserProfileIdentityConflictError",
			uid: "uid-1",
			conflictingUid: "other-uid",
		});
		expect(persistUserDoc).not.toHaveBeenCalled();
	});

	it("rejects an email owned by another Firebase uid in Firestore", async () => {
		findFirestoreUserByEmail.mockReturnValue(Effect.succeed({ uid: "other-uid" }));

		const result = await runFailure();
		expect(result).toMatchObject({
			_tag: "EnsureUserProfileIdentityConflictError",
			uid: "uid-1",
			conflictingUid: "other-uid",
		});
		expect(persistUserDoc).not.toHaveBeenCalled();
	});

	it("fails closed when the Firestore email ownership lookup fails", async () => {
		findFirestoreUserByEmail.mockReturnValue(Effect.fail(new Error("firestore down")));

		const result = await runFailure();
		expect(result._tag).toBe("EnsureUserProfileRetryableError");
		expect(getAuthUser).not.toHaveBeenCalled();
		expect(persistUserDoc).not.toHaveBeenCalled();
	});

	it("queues existing pending profiles on the signup queue even when names are already real", async () => {
		loadFirestoreUser.mockReturnValue(
			Effect.succeed({ ...input, firstName: "Ada", ccbEnrichmentPending: true }),
		);
		loadPostgresUser.mockReturnValue(
			Effect.succeed({ ...pgRow, ccbProfileCheckedAt: new Date(Date.now() - 2 * dayMs) }),
		);
		const outcome = await runSuccess();
		expect(outcome.enrichmentPending).toBe(true);
		expect(enqueueEnrichment).toHaveBeenCalledWith(input);
		expect(enqueueRefresh).not.toHaveBeenCalled();
		expect(persistUserDoc).not.toHaveBeenCalled();
	});

	it("waits a day before queueing another repair of a recently checked profile", async () => {
		loadFirestoreUser.mockReturnValue(
			Effect.succeed({ ...input, firstName: "Ada", ccbEnrichmentPending: true }),
		);
		loadPostgresUser.mockReturnValue(
			Effect.succeed({ ...pgRow, ccbProfileCheckedAt: new Date(Date.now() - 60 * 60 * 1000) }),
		);
		expect(await runSuccess()).toMatchObject({ enrichmentPending: true });
		expect(enqueueEnrichment).not.toHaveBeenCalled();
		expect(enqueueRefresh).not.toHaveBeenCalled();
	});

	it("queues Postgres-only placeholder drift and surfaces enqueue failures", async () => {
		loadFirestoreUser.mockReturnValue(
			Effect.succeed({ ...input, firstName: "Ada", lastName: "Lovelace" }),
		);
		loadPostgresUser.mockReturnValue(
			Effect.succeed({ ...pgRow, firstName: "Hi", lastName: "There", ccbProfileCheckedAt: null }),
		);
		enqueueEnrichment.mockReturnValue(Effect.fail("queue unavailable"));
		const failure = await runFailure();
		expect(failure._tag).toBe("EnsureUserProfileRetryableError");
		expect(enqueueEnrichment).toHaveBeenCalledWith(input);
		expect(enqueueRefresh).not.toHaveBeenCalled();
	});

	it("still succeeds for a complete profile when its weekly check cannot be queued", async () => {
		loadFirestoreUser.mockReturnValue(
			Effect.succeed({ ...input, firstName: "Ada", lastName: "Lovelace" }),
		);
		loadPostgresUser.mockReturnValue(Effect.succeed({ ...pgRow, ccbProfileCheckedAt: null }));
		enqueueRefresh.mockReturnValue(Effect.fail("queue unavailable"));
		expect(await runSuccess()).toMatchObject({
			created: false,
			enrichmentPending: false,
			message: "Profile already exists",
		});
		expect(enqueueRefresh).toHaveBeenCalledWith(input);
	});

	it("stops waiting on a stalled weekly check after five seconds", async () => {
		loadFirestoreUser.mockReturnValue(
			Effect.succeed({ ...input, firstName: "Ada", lastName: "Lovelace" }),
		);
		loadPostgresUser.mockReturnValue(Effect.succeed({ ...pgRow, ccbProfileCheckedAt: null }));
		enqueueRefresh.mockReturnValue(Effect.never);
		const outcome = await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(ensure());
				yield* TestClock.adjust("5 seconds");
				return yield* Fiber.join(fiber);
			}).pipe(Effect.provide(TestClock.layer())),
		);
		expect(outcome).toMatchObject({ created: false, message: "Profile already exists" });
	});
});
