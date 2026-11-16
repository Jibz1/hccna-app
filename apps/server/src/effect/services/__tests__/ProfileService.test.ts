import { AppConfig } from "@/effect/AppConfig";
import { LRUServiceLive } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { makeMockRedis, testAppConfig } from "@/effect/services/__tests__/fixtures";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { ProfileService, ProfileServiceLive } from "@/effect/services/ProfileService";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

const timestamp = new Date("2026-10-18T12:00:00Z");
const cachedProfile = {
	id: "profile-1",
	firebaseUid: "uid-1",
	email: "ada@example.com",
	firstName: "Ada",
	lastName: "Example",
	isVerified: true,
	enrichmentPending: false,
	campusPreferenceVersion: 0,
	createdAt: timestamp.toISOString(),
	updatedAt: timestamp.toISOString(),
};

type CachedProfile = typeof cachedProfile & { readonly ccbProfileCheckedAt?: string | null };

const readCachedProfile = async (data: CachedProfile) => {
	const select = mock(() => {
		throw new Error("A valid Redis profile must not query Postgres");
	});
	const lruLayer = LRUServiceLive.pipe(Layer.provide(Layer.succeed(AppConfig, testAppConfig)));
	const dependencies = Layer.mergeAll(
		lruLayer,
		Layer.succeed(
			RedisService,
			makeMockRedis({
				get: () => Effect.succeed(JSON.stringify({ data, cachedAt: Date.now() })),
			}) as never,
		),
		Layer.succeed(DrizzleService, { db: { select } } as never),
	);
	const layer = ProfileServiceLive.pipe(Layer.provide(dependencies));
	const program = ProfileService.use((service) => service.getByFirebaseUid("uid-1")).pipe(
		Effect.provide(layer),
	);
	return await Effect.runPromise(program);
};

describe("profile CCB check timestamp cache", () => {
	it("decodes a timestamp from Redis so a completed weekly check stays fresh", async () => {
		const result = await readCachedProfile({
			...cachedProfile,
			ccbProfileCheckedAt: timestamp.toISOString(),
		});
		expect(result?.ccbProfileCheckedAt).toEqual(timestamp);
	});

	it.each([cachedProfile, { ...cachedProfile, ccbProfileCheckedAt: null }])(
		"accepts cached profiles from before weekly checks were tracked (%j)",
		async (data) => {
			const result = await readCachedProfile(data);
			expect(result?.firebaseUid).toBe("uid-1");
			expect(result?.ccbProfileCheckedAt).toBeNull();
		},
	);
});
