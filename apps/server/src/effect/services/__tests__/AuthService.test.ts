import { AppConfig } from "@/effect/AppConfig";
import { testAppConfig } from "@/effect/services/__tests__/fixtures";
import { AuthService, type AuthResult } from "@/effect/services/AuthService";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { FirebaseAuthService, FirebaseAuthError } from "@/effect/services/FirebaseAuthService";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

import type { CreateRequest, DecodedIdToken } from "firebase-admin/auth";

const invalidToken = () =>
	Effect.fail(
		new FirebaseAuthError({
			operation: "verifyIdToken",
			code: "auth/invalid-id-token",
		}),
	);
const verifyIdTokenMock =
	mock<() => Effect.Effect<DecodedIdToken, FirebaseAuthError>>(invalidToken);
const updateUserActivityMock = mock((_uid: string, _appVersion: string | undefined) => Effect.void);
let configuredSharedToken = "test-api-token";
const readSharedTokenMock = mock(() =>
	Promise.resolve({ data: () => ({ token: configuredSharedToken }) }),
);

const fakeFirebaseAuthService = {
	createCustomToken: mock((uid: string) => Effect.succeed(`token:${uid}`)),
	createUser: mock((input: CreateRequest) => Effect.succeed(input as never)),
	generateSignInWithEmailLink: mock((email: string) =>
		Effect.succeed(`https://example.com/${email}`),
	),
	getUserByEmail: mock((email: string) => Effect.succeed({ uid: email } as never)),
	verifyIdToken: verifyIdTokenMock,
};

const fakeFirebaseAdmin = {
	app: {} as never,
	auth: {} as never,
	collections: {
		config: "config",
		userConfigDoc: "user-config",
	} as never,
	db: {
		collection: mock(() => ({
			doc: mock(() => ({
				get: readSharedTokenMock,
			})),
		})),
	} as never,
	dbFieldValue: {} as never,
	fieldPath: {} as never,
	getStorageBucket: () => ({}) as never,
	paths: {} as never,
	secondaryApp: {} as never,
	secondaryDb: {} as never,
	sendMessage: () => Effect.succeed("ok"),
	updateUserActivity: updateUserActivityMock,
};

const DependenciesLayer = Layer.mergeAll(
	Layer.succeed(AppConfig, testAppConfig as never),
	Layer.succeed(FirebaseAdminService, fakeFirebaseAdmin as never),
	Layer.succeed(FirebaseAuthService, fakeFirebaseAuthService as never),
);

const TestLayer = Layer.effect(AuthService, AuthService.make).pipe(
	Layer.provide(DependenciesLayer),
);

const runProvided = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
	Effect.runPromise(effect as never);

describe("AuthService.authenticateRequest", () => {
	it("rejects a previously accepted token immediately after revocation", async () => {
		const revoked = new FirebaseAuthError({
			operation: "verifyIdToken",
			code: "auth/id-token-revoked",
			cause: { code: "auth/id-token-revoked" },
		});
		verifyIdTokenMock
			.mockImplementationOnce(() =>
				Effect.succeed({
					uid: "deleted-uid",
					exp: Math.floor(Date.now() / 1000) + 3600,
					firebase: { sign_in_provider: "apple.com" },
				} as never),
			)
			.mockImplementationOnce(() => Effect.fail(revoked) as never);
		const results = (await runProvided(
			Effect.gen(function* () {
				const service = yield* AuthService;
				const request = new Request("http://localhost/graphql", {
					headers: { authorization: "Bearer revoked.apple.token", "x-auth-method": "firebase" },
				});
				const before = yield* service.authenticateRequest(request);
				const after = yield* service.authenticateRequest(request);
				return { before, after };
			}).pipe(Effect.provide(TestLayer)),
		)) as { before: AuthResult; after: AuthResult | null };
		expect(results.before.authorized).toBe(true);
		expect(results.after).toBeNull();
		expect(verifyIdTokenMock).toHaveBeenCalledTimes(2);
	});

	beforeEach(() => {
		verifyIdTokenMock.mockReset();
		verifyIdTokenMock.mockImplementation(invalidToken);
		configuredSharedToken = "test-api-token";
		readSharedTokenMock.mockClear();
		updateUserActivityMock.mockClear();
	});

	it("rechecks an unhinted Firebase token on every request, including after revocation", async () => {
		const accepted = Effect.succeed({
			uid: "unhinted-revoked-user",
			firebase: { sign_in_provider: "apple.com" },
		} as DecodedIdToken);
		verifyIdTokenMock
			.mockImplementationOnce(() => accepted)
			.mockImplementationOnce(() => accepted)
			.mockImplementationOnce(() =>
				Effect.fail(
					new FirebaseAuthError({ operation: "verifyIdToken", code: "auth/id-token-revoked" }),
				),
			);
		const results = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* AuthService;
				const request = new Request("http://localhost/graphql", {
					headers: { authorization: "Bearer unhinted.revoked.token" },
				});
				return yield* Effect.all(
					[
						service.authenticateRequest(request),
						service.authenticateRequest(request),
						service.authenticateRequest(request),
					],
					{ concurrency: 1 },
				);
			}).pipe(Effect.provide(TestLayer)),
		);
		expect(results.map((result) => result?.uid ?? null)).toEqual([
			"unhinted-revoked-user",
			"unhinted-revoked-user",
			null,
		]);
		expect(verifyIdTokenMock).toHaveBeenCalledTimes(3);
	});

	it.each([
		"auth/id-token-revoked",
		"auth/user-disabled",
		"auth/user-not-found",
		"auth/id-token-expired",
	])("rejects invalid Firebase credentials (%s)", async (code) => {
		verifyIdTokenMock.mockImplementationOnce(() =>
			Effect.fail(new FirebaseAuthError({ operation: "verifyIdToken", code })),
		);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* AuthService;
				return yield* service.authenticateRequest(
					new Request("http://localhost/graphql", {
						headers: { authorization: "Bearer invalid.apple.token", "x-auth-method": "firebase" },
					}),
				);
			}).pipe(Effect.provide(TestLayer)),
		);
		expect(result).toBeNull();
	});

	it("returns firebaseAnonymous when sign_in_provider is anonymous", async () => {
		verifyIdTokenMock.mockImplementationOnce(() =>
			Effect.succeed({
				uid: "anon-uid-123",
				email: null,
				firebase: {
					sign_in_provider: "anonymous",
				},
			} as never),
		);

		const result = (await runProvided(
			Effect.gen(function* () {
				const authService = yield* AuthService;
				return yield* authService.authenticateRequest(
					new Request("http://localhost/graphql", {
						headers: {
							authorization: "Bearer part1.part2.part3",
						},
					}),
				);
			}).pipe(Effect.provide(TestLayer)),
		)) as AuthResult | null | undefined;

		expect(result?.authorized).toBe(true);
		expect(result?.uid).toBe("anon-uid-123");
		expect(result?.authType).toBe("firebaseAnonymous");
		expect(updateUserActivityMock).not.toHaveBeenCalled();
	});

	it("records user activity once per app version, so an upgrade inside the window is kept", async () => {
		verifyIdTokenMock.mockImplementation(() =>
			Effect.succeed({
				uid: "upgrading-user",
				firebase: { sign_in_provider: "custom" },
			} as never),
		);
		const requestFrom = (appVersion: string) =>
			new Request("http://localhost/graphql", {
				headers: {
					authorization: "Bearer upgrading.user.token",
					"x-hccna-app-version": appVersion,
				},
			});

		await runProvided(
			Effect.gen(function* () {
				const service = yield* AuthService;
				// The force-update overlay sends users to the store; they relaunch seconds later.
				yield* service.authenticateRequest(requestFrom("1.1.4"));
				yield* service.authenticateRequest(requestFrom("1.1.4"));
				yield* service.authenticateRequest(requestFrom("2.0.0"));
				// Activity writes run on detached fibers.
				yield* Effect.yieldNow;
			}).pipe(Effect.provide(TestLayer)),
		);

		// Earlier tests' detached writes can land here too, so look only at this user.
		const writes = updateUserActivityMock.mock.calls.filter(([uid]) => uid === "upgrading-user");
		expect(writes).toEqual([
			["upgrading-user", "1.1.4"],
			["upgrading-user", "2.0.0"],
		]);
	});
});
