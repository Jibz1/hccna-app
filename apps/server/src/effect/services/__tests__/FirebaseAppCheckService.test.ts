import { AppConfig, type AppConfigContract } from "@/effect/AppConfig";
import { testAppConfig } from "@/effect/services/__tests__/fixtures";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import {
	FIREBASE_APP_CHECK_HEADER,
	FirebaseAppCheckService,
	makeFirebaseAppCheckServiceLayer,
} from "@/effect/services/FirebaseAppCheckService";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

import type { VerifyAppCheckTokenResponse } from "firebase-admin/app-check";

const fakeFirebaseAdmin = {
	app: {} as never,
	auth: {} as never,
	collections: {} as never,
	db: {} as never,
	dbFieldValue: {} as never,
	fieldPath: {} as never,
	getStorageBucket: () => ({}) as never,
	mergeUserDocument: () => Effect.void,
	paths: {} as never,
	secondaryApp: {} as never,
	secondaryDb: {} as never,
	sendMessage: () => Effect.succeed("ok"),
	verifyAppCheckToken: () => Promise.resolve(verifiedResponse("unused")),
};

function verifiedResponse(appId: string): VerifyAppCheckTokenResponse {
	return {
		appId,
		token: {
			app_id: appId,
			aud: ["project-number", "project-id"],
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
			iss: "https://firebaseappcheck.googleapis.com/project-number",
			sub: appId,
		},
	};
}

function makeConfig(appCheck: AppConfigContract["appCheck"]): AppConfigContract {
	return {
		...testAppConfig,
		appCheck,
	};
}

async function verifyWithConfig(
	config: AppConfigContract,
	verifyToken: (token: string) => Promise<VerifyAppCheckTokenResponse>,
	request: Request,
) {
	const configLayer = Layer.succeed(AppConfig, config as never);
	const firebaseAdminLayer = Layer.succeed(FirebaseAdminService, fakeFirebaseAdmin as never);
	const dependencyLayer = Layer.mergeAll(configLayer, firebaseAdminLayer);
	const layer = makeFirebaseAppCheckServiceLayer({ verifyToken }).pipe(
		Layer.provide(dependencyLayer),
	);

	return await Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* FirebaseAppCheckService;
			return yield* service.verifyRequest(request);
		}).pipe(Effect.provide(layer)),
	);
}

describe("FirebaseAppCheckService", () => {
	it("rejects when Firebase Admin rejects the App Check token", async () => {
		const verifyToken = mock(() => Promise.reject(new Error("invalid token")));

		await expect(
			verifyWithConfig(
				makeConfig({ enforcement: "enforce", allowedAppIds: [] }),
				verifyToken,
				new Request("http://localhost/graphql", {
					headers: {
						[FIREBASE_APP_CHECK_HEADER]: "invalid-token",
					},
				}),
			),
		).rejects.toMatchObject({
			_tag: "FirebaseAppCheckVerificationError",
			httpStatus: 401,
		});
	});

	it("fails when the App Check header is missing", async () => {
		const verifyToken = mock(() => Promise.resolve(verifiedResponse("app-1")));

		await expect(
			verifyWithConfig(
				makeConfig({ enforcement: "enforce", allowedAppIds: [] }),
				verifyToken,
				new Request("http://localhost/graphql"),
			),
		).rejects.toMatchObject({
			_tag: "FirebaseAppCheckMissingTokenError",
		});
		expect(verifyToken).not.toHaveBeenCalled();
	});

	it("rejects verified tokens from app ids outside the allowlist", async () => {
		const verifyToken = mock(() => Promise.resolve(verifiedResponse("ios-app-id")));

		await expect(
			verifyWithConfig(
				makeConfig({ enforcement: "enforce", allowedAppIds: ["web-app-id"] }),
				verifyToken,
				new Request("http://localhost/graphql", {
					headers: {
						[FIREBASE_APP_CHECK_HEADER]: "valid-token",
					},
				}),
			),
		).rejects.toMatchObject({
			_tag: "FirebaseAppCheckAppNotAllowedError",
		});
	});
});
