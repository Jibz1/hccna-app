import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	auth: {
		getUserByEmail: mock(),
	},
	db: {
		collection: mock(() => ({
			doc: mock(() => ({
				get: mock(),
				delete: mock(),
			})),
		})),
		recursiveDelete: mock(() => Promise.resolve()),
	},
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
	redis: {
		get: mock(),
		set: mock(),
		mget: mock(),
		expire: mock(),
	},
}));

void mock.module("@sendgrid/mail", () => ({
	default: {
		setApiKey: mock(),
		send: mock(() => Promise.resolve()),
	},
}));

const returningMock = mock(() => Promise.resolve([{ id: "row-1", email: "deleted@example.com" }]));
const whereMock = mock(<Condition>(_condition: Condition) => ({ returning: returningMock }));
const deleteMock = mock(<Table>(_table: Table) => ({ where: whereMock }));
const mockDb = { delete: deleteMock };

void mock.module("@/db", () => ({
	db: mockDb,
	pool: {
		query: mock(() => Promise.resolve({ rows: [] })),
	},
}));

const { DrizzleService } = await import("@/effect/services/DrizzleService");
const { FirebaseAdminService } = await import("@/effect/services/FirebaseAdminService");
const { deleteAccountEffect, deleteUserPostgresEffect, deleteUserFireStoreEffect } =
	await import("../schema/user/user");
const { FirebaseAuthService } = await import("@/effect/services/FirebaseAuthService");
const { MailService } = await import("@/effect/services/MailService");

const { ProfileService } = await import("@/effect/services/ProfileService");
const clearCacheMock = mock(
	(_options: { firebaseUid?: string; id?: string; email?: string }) => Effect.void,
);
const DrizzleTestLayer = Layer.mergeAll(
	Layer.succeed(DrizzleService, { db: mockDb } as never),
	Layer.succeed(ProfileService, { clearCache: clearCacheMock } as never),
);

describe("deleteUserPostgresEffect", () => {
	beforeEach(() => {
		deleteMock.mockClear();
		clearCacheMock.mockClear();
		whereMock.mockClear();
		returningMock.mockClear();
		returningMock.mockReturnValue(Promise.resolve([{ id: "row-1", email: "deleted@example.com" }]));
	});

	it("succeeds when no Postgres row exists for the account", async () => {
		returningMock.mockReturnValue(Promise.resolve([]));

		await Effect.runPromise(
			deleteUserPostgresEffect("firebase-uid-without-row").pipe(
				Effect.provide(DrizzleTestLayer),
			) as Effect.Effect<void>,
		);

		expect(deleteMock).toHaveBeenCalledTimes(1);
		expect(clearCacheMock).toHaveBeenCalledWith({ firebaseUid: "firebase-uid-without-row" });
	});
});

describe("deleteAccountEffect sequencing", () => {
	it.each(["none", "postgres", "firestore", "revoke", "auth"])(
		"keeps database failures retryable and deletes auth last (failure: %s)",
		async (failure) => {
			const stages: string[] = [];
			const step = (stage: string) => {
				stages.push(stage);
				return failure === stage
					? Promise.reject(new Error(`${stage} unavailable`))
					: Promise.resolve();
			};
			const firebase = {
				collections: { users: "app-users", deleteAccountCode: "delete-account-code" },
				db: {
					runTransaction: <A>(
						run: (transaction: {
							get: () => Promise<{
								exists: boolean;
								data: () => { code: string; expiresAt: number };
							}>;
							delete: () => void;
						}) => Promise<A>,
					) =>
						run({
							get: () =>
								Promise.resolve({
									exists: true,
									data: () => ({ code: "123456", expiresAt: Date.now() + 60_000 }),
								}),
							delete: () => {},
						}),
					collection: () => ({
						doc: () => ({
							get: () =>
								Promise.resolve({
									exists: true,
									data: () => ({ code: "123456", expiresAt: Date.now() + 60_000 }),
								}),
							delete: () => Promise.resolve(),
						}),
					}),
					recursiveDelete: () => step("firestore"),
				},
				auth: { revokeRefreshTokens: () => step("revoke"), deleteUser: () => step("auth") },
			};
			const layer = Layer.mergeAll(
				Layer.succeed(FirebaseAdminService, firebase as never),
				Layer.succeed(FirebaseAuthService, {
					getUserByEmail: () => Effect.succeed({ uid: "deleted-uid" }),
					createCustomToken: () => Effect.succeed("unused-token"),
				} as never),
				Layer.succeed(MailService, {} as never),
				Layer.succeed(ProfileService, { clearCache: () => Effect.void } as never),
				Layer.succeed(DrizzleService, {
					db: {
						delete: () => ({
							where: () => ({
								returning: async () => {
									await step("postgres");
									return [{ id: "row-1", email: "deleted@example.com" }];
								},
							}),
						}),
					},
				} as never),
			);
			const result = await Effect.runPromise(
				deleteAccountEffect({ email: "deleted@example.com", code: "123456" }).pipe(
					Effect.result,
					Effect.provide(layer),
				),
			);
			const ordered = ["postgres", "firestore", "revoke", "auth"];
			expect(stages).toEqual(
				failure === "none" ? ordered : ordered.slice(0, ordered.indexOf(failure) + 1),
			);
			expect(result._tag).toBe(failure === "none" ? "Success" : "Failure");
		},
	);
});

describe("deleteUserFireStoreEffect", () => {
	const userDocRef = { path: "app-users/firebase-uid-123" };
	const docMock = mock((_uid: string) => userDocRef);
	const collectionMock = mock((_name: string) => ({ doc: docMock }));
	const recursiveDeleteMock = mock(<Ref>(_ref: Ref) => Promise.resolve());

	const mockFirebase = {
		db: { collection: collectionMock, recursiveDelete: recursiveDeleteMock },
		collections: { users: "app-users" },
	};
	const FirebaseTestLayer = Layer.succeed(FirebaseAdminService, mockFirebase as never);

	beforeEach(() => {
		collectionMock.mockClear();
		docMock.mockClear();
		recursiveDeleteMock.mockClear();
		recursiveDeleteMock.mockReturnValue(Promise.resolve());
	});

	it("recursively deletes the user document", async () => {
		await Effect.runPromise(
			deleteUserFireStoreEffect("firebase-uid-123").pipe(
				Effect.provide(FirebaseTestLayer),
			) as Effect.Effect<void>,
		);

		expect(collectionMock).toHaveBeenCalledWith("app-users");
		expect(docMock).toHaveBeenCalledWith("firebase-uid-123");
		expect(recursiveDeleteMock).toHaveBeenCalledWith(userDocRef);
	});
});
