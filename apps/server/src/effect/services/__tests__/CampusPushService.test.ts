import { CampusPreferenceStore } from "@/effect/services/CampusPreferenceStore";
import { CampusPushService, CampusPushServiceLive } from "@/effect/services/CampusPushService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { PushTokenService } from "@/effect/services/PushTokenService";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

import type { RegisterPushTokenInput } from "@/effect/services/push/firebase";

function harness() {
	const preference = { preferredCampusSlug: "new-breed", campusPreferenceVersion: 2 };
	const registrations: RegisterPushTokenInput[] = [];
	const tokens = [
		{
			token: "one",
			userId: "user",
			logoutKey: "key-one",
			followPreferredCampus: true,
			topics: ["announcement", "campus-house-of-stars"],
		},
		{ token: "two", userId: "user", followPreferredCampus: true, topics: ["announcement"] },
	];
	let movedToken = false;
	const dependencies = Layer.mergeAll(
		Layer.succeed(CampusPreferenceStore, {
			get: () => Effect.sync(() => ({ ...preference, firebaseUid: "user", userId: "profile" })),
			finish: () => Effect.void,
		} as never),
		Layer.succeed(PushTokenService, {
			registerToken: (input: RegisterPushTokenInput) =>
				Effect.sync(() => {
					registrations.push(input);
					return {
						token: input.token,
						topics: ["announcement"],
						campusSlug: input.campus?.slug,
						campusPreferenceVersion: input.campus?.version,
					};
				}),
		} as never),
		Layer.succeed(FirebaseAdminService, {
			collections: { pushTokens: "tokens" },
			mirrorUserCampusPreference: () => Effect.void,
			listPushTokenDocsByUserId: () => Effect.succeed(tokens),
			readDocument: (_collection: string, token: string) =>
				Effect.succeed(
					movedToken && token === "one"
						? { userId: null }
						: tokens.find((doc) => doc.token === token),
				),
		} as never),
		Layer.succeed(DrizzleService, {
			pool: {
				connect: () =>
					Promise.resolve({
						query: () => Promise.resolve({ rows: [{ locked: true }] }),
						release: () => {},
					}),
			},
		} as never),
	);
	const layer = CampusPushServiceLive.pipe(Layer.provide(dependencies));
	const run = <A, E>(effect: Effect.Effect<A, E, CampusPushService>) =>
		Effect.runPromise(effect.pipe(Effect.provide(layer)));
	return {
		run,
		registrations,
		moveToken: () => {
			movedToken = true;
		},
	};
}

describe("CampusPushService", () => {
	it("rechecks ownership under the token lock", async () => {
		const h = harness();
		h.moveToken();
		await h.run(CampusPushService.use((s) => s.syncUser("user")));
		expect(h.registrations.map((r) => r.token)).toEqual(["two"]);
	});
	it("keeps each registration's logout key when the campus changes", async () => {
		const h = harness();
		await h.run(CampusPushService.use((s) => s.syncUser("user")));
		expect(h.registrations.map(({ token, logoutKey }) => ({ token, logoutKey }))).toEqual([
			{ token: "one", logoutKey: "key-one" },
			{ token: "two", logoutKey: null },
		]);
	});
});
