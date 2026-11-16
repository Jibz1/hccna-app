import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import {
	FirebaseAuthService,
	makeFirebaseAuthServiceLayer,
	FIREBASE_TOKEN_VERIFICATION_TIMEOUT_MS,
} from "@/effect/services/FirebaseAuthService";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import type { DecodedIdToken } from "firebase-admin/auth";

const fakeFirebaseAdmin = {
	app: {} as never,
	collections: {} as never,
	db: {} as never,
	dbFieldValue: {} as never,
	fieldPath: {} as never,
	paths: {} as never,
	secondaryApp: {} as never,
	secondaryDb: {} as never,
	getStorageBucket: () => ({}) as never,
	sendMessage: () => Effect.succeed("ok"),
};

describe("FirebaseAuthService", () => {
	it("bounds a pending revocation lookup without accepting the token", async () => {
		const verifyIdToken = mock(() => new Promise<DecodedIdToken>(() => {}));
		const layer = makeFirebaseAuthServiceLayer().pipe(
			Layer.provide(
				Layer.succeed(FirebaseAdminService, {
					...fakeFirebaseAdmin,
					auth: { verifyIdToken },
				} as never),
			),
		);
		const timeoutLayer = Layer.merge(layer, TestClock.layer());
		const error = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* FirebaseAuthService;
				const fiber = yield* Effect.forkChild(Effect.flip(service.verifyIdToken("token")));
				yield* TestClock.adjust(FIREBASE_TOKEN_VERIFICATION_TIMEOUT_MS);
				return yield* Fiber.join(fiber);
			}).pipe(Effect.provide(timeoutLayer)),
		);
		expect(error.code).toBe("auth/verification-timeout");
		expect(verifyIdToken).toHaveBeenCalledWith("token", true);
	});
});
