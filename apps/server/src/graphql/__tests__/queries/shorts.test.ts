import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { execute, parse } from "graphql";

import type { ShortItem } from "@/effect/services/shorts/ShortsService";

// Module mocks must be before any imports that use them. They only prevent real SDK
// initialization during schema import — the resolver reads shorts through ShortsService,
// faked per test below.
void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	db: { collection: mock() },
	secondaryDb: {},
	dbFieldValue: {},
	fieldPath: {},
	FBPaths: {},
	getStorageBucket: mock(),
	AppCollections: { users: "app-users", castrStreams: "castr-streams" },
	auth: { getUserByEmail: mock() },
}));

void mock.module("@/redis", () => ({
	redis: {
		get: mock(() => Promise.resolve(null)),
		set: mock(),
		mget: mock(),
		expire: mock(),
	},
}));

void mock.module("@/effect/Runtime", () => ({
	AppLayer: Layer.empty,
	managedRuntime: {
		runPromise: mock(() => Promise.resolve({ message: "Success" })),
	},
}));

const { schema } = await import("@/graphql/schema");
const { ShortsService } = await import("@/effect/services/shorts/ShortsService");
const { anonymous, authorized } = await import("../utils/test-context");

const SHORTS = parse(`
	query Shorts {
		shorts { id videoId title channelTitle thumbnail curated }
	}
`);

const requestShorts = (shorts: readonly ShortItem[]) => {
	const layer = Layer.succeed(ShortsService, { list: Effect.succeed(shorts) });
	return execute({
		schema,
		document: SHORTS,
		contextValue: authorized({
			effectRunPromise: <A, E, R>(program: Effect.Effect<A, E, R>) =>
				Effect.runPromise(program.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>),
		}),
	});
};

describe("shorts query", () => {
	it("returns the service's list", async () => {
		const result = await requestShorts([
			{
				videoId: "aaaaaaaaaa1",
				title: "Sample short one",
				channelTitle: "Example Channel",
				thumbnail: "https://example.com/1.jpg",
				curated: false,
			},
			{
				videoId: "aaaaaaaaaa2",
				title: "Sample short two",
				channelTitle: "Example Channel",
				thumbnail: null,
				curated: true,
			},
		]);

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			shorts: [
				{
					id: "Short:aaaaaaaaaa1",
					videoId: "aaaaaaaaaa1",
					title: "Sample short one",
					channelTitle: "Example Channel",
					thumbnail: "https://example.com/1.jpg",
					curated: false,
				},
				{
					id: "Short:aaaaaaaaaa2",
					videoId: "aaaaaaaaaa2",
					title: "Sample short two",
					channelTitle: "Example Channel",
					thumbnail: null,
					curated: true,
				},
			],
		});
	});

	it("returns an empty list", async () => {
		const result = await requestShorts([]);

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({ shorts: [] });
	});

	// The list is the same for everyone and already cached by ShortsService; the response
	// cache keys by caller, so holding it there would store one large copy per signed-in user.
	it("is not held in the per-caller response cache", async () => {
		const { responseCacheTtlPerSchemaCoordinate } = await import("@/graphql/responseCache");

		expect(responseCacheTtlPerSchemaCoordinate["Query.shorts"]).toBe(0);
	});

	it("rejects an unauthenticated request", async () => {
		const result = await execute({ schema, document: SHORTS, contextValue: anonymous() });

		expect(result.errors).toBeDefined();
		// A failed non-null root field leaves no data at all.
		expect(result.data).toBeNull();
	});
});
