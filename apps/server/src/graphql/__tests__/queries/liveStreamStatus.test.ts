import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { execute, parse } from "graphql";

// Module mocks must be before any imports that use them. The firebase mock
// only prevents real SDK initialization during schema import — the resolver
// goes through StreamProjectionStore, faked per test below.
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

// Import schema and services after mocks are set up
const { schema } = await import("@/graphql/schema");
const { StreamProjectionStore } = await import("@/effect/services/StreamProjectionStore");
const { createMockContext } = await import("../utils/test-context");
const { createStreamMetadataDataLoader } =
	await import("@/graphql/loaders/streamMetadataDataLoader");

class FakeReadError extends Schema.TaggedError<FakeReadError>()("LiveStreamConfigReadError", {}) {}
class FakeMetadataReadError extends Schema.TaggedError<FakeMetadataReadError>()(
	"StreamProjectionReadError",
	{},
) {}

const LIVE_STREAMS = [
	{ id: "stream-hos", slug: "house-of-stars", isLive: true },
	{ id: "stream-bk", slug: "brooklyn", isLive: false },
	{ id: "stream-unmapped", isLive: false },
];

const LIVE_STREAM_STATUS_QUERY = `
	query LiveStreamStatusQuery($slug: String) {
		liveStreamStatus(slug: $slug) {
			__typename
			... on LiveStreamStatusSuccess {
				streams {
					id
					slug
					isLive
				}
			}
			... on LiveStreamStatusFetchError {
				message
			}
		}
	}
`;

const LIVE_STREAM_METADATA_QUERY = `
	query LiveStreamMetadataQuery($slug: String) {
		liveStreamStatus(slug: $slug) {
			__typename
			... on LiveStreamStatusSuccess {
				streams { id slug isLive title description }
			}
			... on LiveStreamStatusFetchError { message }
		}
	}
`;

interface LiveStreamStatusData {
	liveStreamStatus:
		| {
				__typename: "LiveStreamStatusSuccess";
				streams: {
					id: string;
					slug: string | null;
					isLive: boolean;
					title?: string | null;
					description?: string | null;
				}[];
		  }
		| { __typename: "LiveStreamStatusFetchError"; message: string }
		| null;
}

interface HarnessOptions {
	getLiveStreams?: () => Effect.Effect<
		{
			id: string;
			slug?: string;
			isLive: boolean;
			metadata?: { title: string; description: string };
		}[],
		FakeReadError
	>;
	getCachedPublicMetadata?: (
		streamId: string,
	) => Effect.Effect<
		{ title: string | undefined; description: string | undefined },
		FakeMetadataReadError
	>;
	authorized?: boolean;
	authType?: "firebaseAnonymous" | null;
}

/** Defaults to a Firebase anonymous caller, the weakest auth `authorized` accepts. */
const makeHarness = ({
	getLiveStreams = () => Effect.succeed(LIVE_STREAMS),
	getCachedPublicMetadata = (streamId) =>
		Effect.succeed({ title: `Title for ${streamId}`, description: `Description for ${streamId}` }),
	authorized = true,
	authType = "firebaseAnonymous",
}: HarnessOptions = {}) => {
	const storeFake = {
		getLiveStreams: mock(getLiveStreams),
		getCachedPublicMetadata: mock(getCachedPublicMetadata),
	};
	const runner = (<A, E, R>(program: Effect.Effect<A, E, R>) =>
		Effect.runPromise(
			(program as Effect.Effect<A>).pipe(
				Effect.provideService(StreamProjectionStore, storeFake as never),
			),
		)) as never;
	const context = createMockContext({
		authorized,
		authType,
		effectRunPromise: runner,
		loaders: { streamMetadata: createStreamMetadataDataLoader(runner) },
	});
	return { context, storeFake };
};

const run = async (
	context: ReturnType<typeof makeHarness>["context"],
	slug?: string | null,
	query = LIVE_STREAM_STATUS_QUERY,
) =>
	(await execute({
		schema,
		document: parse(query),
		contextValue: context,
		variableValues: slug === undefined ? {} : { slug },
	})) as { data: LiveStreamStatusData | null; errors?: readonly { message: string }[] };

const ALL_STREAMS: LiveStreamStatusData["liveStreamStatus"] = {
	__typename: "LiveStreamStatusSuccess",
	streams: [
		{ id: "stream-hos", slug: "house-of-stars", isLive: true },
		{ id: "stream-bk", slug: "brooklyn", isLive: false },
		{ id: "stream-unmapped", slug: null, isLive: false },
	],
};

describe("liveStreamStatus query", () => {
	it("returns every stream when no slug is given", async () => {
		const { context, storeFake } = makeHarness();

		const result = await run(context);

		expect(result.errors).toBeUndefined();
		expect(result.data?.liveStreamStatus).toEqual(ALL_STREAMS);
		expect(storeFake.getCachedPublicMetadata).not.toHaveBeenCalled();
	});

	it("loads title and description only for streams matching the requested slug", async () => {
		const { context, storeFake } = makeHarness();

		const result = await run(context, "house-of-stars", LIVE_STREAM_METADATA_QUERY);

		expect(result.errors).toBeUndefined();
		expect(result.data?.liveStreamStatus).toEqual({
			__typename: "LiveStreamStatusSuccess",
			streams: [
				{
					id: "stream-hos",
					slug: "house-of-stars",
					isLive: true,
					title: "Title for stream-hos",
					description: "Description for stream-hos",
				},
			],
		});
		expect(storeFake.getCachedPublicMetadata.mock.calls).toEqual([["stream-hos"]]);
	});

	it("returns null metadata without losing live status when a projection read fails", async () => {
		const { context, storeFake } = makeHarness({
			getCachedPublicMetadata: () => Effect.fail(new FakeMetadataReadError()),
		});

		const result = await run(context, "house-of-stars", LIVE_STREAM_METADATA_QUERY);

		expect(result.errors).toBeUndefined();
		expect(storeFake.getCachedPublicMetadata).toHaveBeenCalledTimes(1);
		expect(result.data?.liveStreamStatus).toEqual({
			__typename: "LiveStreamStatusSuccess",
			streams: [
				{ id: "stream-hos", slug: "house-of-stars", isLive: true, title: null, description: null },
			],
		});
	});

	it("returns null for unavailable metadata and preserves empty strings", async () => {
		const { context } = makeHarness({
			getCachedPublicMetadata: () => Effect.succeed({ title: undefined, description: "" }),
		});

		const result = await run(context, "house-of-stars", LIVE_STREAM_METADATA_QUERY);

		expect(result.errors).toBeUndefined();
		expect(result.data?.liveStreamStatus).toEqual({
			__typename: "LiveStreamStatusSuccess",
			streams: [
				{ id: "stream-hos", slug: "house-of-stars", isLive: true, title: null, description: "" },
			],
		});
	});

	it("reads published metadata without a legacy projection lookup", async () => {
		const metadata = { title: "Service", description: "Welcome" };
		const { context, storeFake } = makeHarness({
			getLiveStreams: () =>
				Effect.succeed([{ id: "stream-hos", slug: "house-of-stars", isLive: true, metadata }]),
		});
		const result = await run(context, undefined, LIVE_STREAM_METADATA_QUERY);
		expect(result.errors).toBeUndefined();
		expect(result.data?.liveStreamStatus).toEqual({
			__typename: "LiveStreamStatusSuccess",
			streams: [{ id: "stream-hos", slug: "house-of-stars", isLive: true, ...metadata }],
		});
		expect(storeFake.getCachedPublicMetadata).not.toHaveBeenCalled();
	});

	it.each([
		{ id: "stream-hos", slug: "house-of-stars", isLive: false },
		{ id: "guest", slug: "guest-stream", isLive: true },
		{ id: "unmapped", isLive: true },
	])("includes metadata for offline and non-campus streams: $id", async (stream) => {
		const metadata = { title: "Service", description: "Welcome" };
		const { context, storeFake } = makeHarness({
			getLiveStreams: () => Effect.succeed([{ ...stream, metadata }]),
		});
		const result = await run(context, undefined, LIVE_STREAM_METADATA_QUERY);
		expect(result.errors).toBeUndefined();
		expect(result.data?.liveStreamStatus).toEqual({
			__typename: "LiveStreamStatusSuccess",
			streams: [{ ...stream, slug: stream.slug ?? null, ...metadata }],
		});
		expect(storeFake.getCachedPublicMetadata).not.toHaveBeenCalled();
	});

	it("does not load metadata for an unknown slug", async () => {
		const { context, storeFake } = makeHarness();

		const result = await run(context, "atlantis", LIVE_STREAM_METADATA_QUERY);

		expect(result.data?.liveStreamStatus).toEqual({
			__typename: "LiveStreamStatusSuccess",
			streams: [],
		});
		expect(storeFake.getCachedPublicMetadata).not.toHaveBeenCalled();
	});

	it("returns only the stream matching the slug, ignoring case and surrounding spaces", async () => {
		const { context } = makeHarness();

		const result = await run(context, "  House-Of-Stars ");

		expect(result.data?.liveStreamStatus).toEqual({
			__typename: "LiveStreamStatusSuccess",
			streams: [{ id: "stream-hos", slug: "house-of-stars", isLive: true }],
		});
	});

	it.each([null, "", "   "])("treats slug %p as omitted", async (slug) => {
		const { context } = makeHarness();

		const result = await run(context, slug);

		expect(result.data?.liveStreamStatus).toEqual(ALL_STREAMS);
	});

	it("returns a typed fetch error when the live-stream config cannot be read", async () => {
		const { context } = makeHarness({ getLiveStreams: () => Effect.fail(new FakeReadError()) });

		const result = await run(context);

		expect(result.errors).toBeUndefined();
		expect(result.data?.liveStreamStatus).toEqual({
			__typename: "LiveStreamStatusFetchError",
			message: "Unable to load live stream status",
		});
	});

	it("rejects callers without any successful authentication", async () => {
		const { context, storeFake } = makeHarness({ authorized: false, authType: null });

		const result = await run(context, undefined, LIVE_STREAM_METADATA_QUERY);

		expect(result.errors).toBeDefined();
		expect(result.data?.liveStreamStatus ?? null).toBeNull();
		expect(storeFake.getLiveStreams).not.toHaveBeenCalled();
		expect(storeFake.getCachedPublicMetadata).not.toHaveBeenCalled();
	});
});
