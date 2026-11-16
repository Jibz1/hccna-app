import { describe, expect, it, mock } from "bun:test";

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

const { classifyProvisioningState, planBackfillAction } = await import("../provisioningBackfill");

const authUser = (uid: string, email: string | null = `${uid}@example.com`) => ({
	uid,
	email,
	creationTime: "2026-07-01T00:00:00Z",
	lastSignInTime: "2026-07-10T00:00:00Z",
});

describe("classifyProvisioningState", () => {
	it("flags every uid touching an email owned by more than one uid", () => {
		const audit = classifyProvisioningState({
			authUsers: [authUser("uid-a", "shared@example.com"), authUser("uid-b", "uid-b@example.com")],
			firestoreUsers: [{ uid: "uid-b", email: "Shared@Example.com" }],
			postgresUsers: [],
		});

		const byUid = new Map(audit.users.map((user) => [user.uid, user]));
		expect(byUid.get("uid-a")?.conflicted).toBe(true);
		expect(byUid.get("uid-b")?.conflicted).toBe(true);
		expect(audit.conflicts).toHaveLength(1);
		expect(audit.conflicts[0]?.email).toBe("shared@example.com");
		expect(new Set(audit.conflicts[0]?.uids)).toEqual(new Set(["uid-a", "uid-b"]));
		expect(audit.counts.conflicts).toBe(1);
	});
});

describe("planBackfillAction", () => {
	const base = {
		uid: "uid-1",
		email: "uid-1@example.com",
		category: "complete" as const,
		enrichmentPending: false,
		conflicted: false,
		emailDrift: false,
	};

	it("never acts on conflicted users, even when repair would apply", () => {
		const plan = planBackfillAction(
			{ ...base, category: "firestore-only", conflicted: true },
			{ createMissing: true },
		);
		expect(plan).toEqual({
			action: "skip",
			uid: "uid-1",
			email: "uid-1@example.com",
			reason: "identity-conflict",
		});
	});
});
