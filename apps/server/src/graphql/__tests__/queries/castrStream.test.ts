import { describe, expect, it, mock } from "bun:test";
import { Layer, Effect } from "effect";
import { execute, parse } from "graphql";

const mockCastrStreamData = {
	id: "stream-123",
	name: "House of Stars Stream",
	enabled: true,
	broadcasting_status: "offline" as const,
	title: "Sunday Service",
	description: "Live Sunday Service",
	platforms: [
		{
			id: "platform-1",
			name: "YouTube",
			enabled: true,
			template: "youtube",
			broadcasting_status: "offline" as const,
			key: "stream-key-123",
		},
		{
			id: "platform-2",
			name: "Facebook",
			enabled: true,
			template: "facebook",
			broadcasting_status: "offline" as const,
			key: "stream-key-456",
		},
	],
};

// Module mocks must be before any imports that use them. The firebase mock
// only prevents real SDK initialization during schema import — the castr
// resolvers go through StreamProjectionStore, faked per test below.
void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	db: {
		collection: mock(() => ({
			doc: mock(() => ({
				// oxlint-disable-next-line no-null
				get: mock(() => Promise.resolve({ exists: false, data: () => null })),
				set: mock(),
				update: mock(),
			})),
		})),
	},
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
const { StrapiStreamAclProvider } = await import("@/effect/services/StrapiStreamAclProvider");
const { StreamProjectionStore } = await import("@/effect/services/StreamProjectionStore");
const { createMockContext } = await import("../utils/test-context");

interface GraphQLTestResult<TData = NonNullable<Awaited<ReturnType<typeof execute>>["data"]>> {
	data: TData | null;
	errors?: readonly { message: string }[];
}

async function executeGraphQL<TData = NonNullable<Awaited<ReturnType<typeof execute>>["data"]>>(
	query: string,
	context: Parameters<typeof execute>[0]["contextValue"],
	variables?: NonNullable<Parameters<typeof execute>[0]["variableValues"]>,
): Promise<GraphQLTestResult<TData>> {
	const document = parse(query);
	const result = await execute({
		schema,
		document,
		contextValue: context,
		variableValues: variables,
	});
	return result as GraphQLTestResult<TData>;
}

function isAuthError(result: GraphQLTestResult): boolean {
	return (
		result.errors?.some(
			(e) => e.message.includes("Not authorized") || e.message.includes("unauthorized"),
		) ?? false
	);
}

interface QueryHarnessOptions {
	coordinators?: { normalizedEmail: string; excludedPlatformIds: string[] }[];
	callerEmail?: string;
	streamDoc?: typeof mockCastrStreamData;
}

/**
 * Resolver harness with fakes at the service seams: the Strapi ACL adapter and
 * the Firestore projection store, provided through the request-scoped Effect
 * runner the same way the production runtime provides the real services.
 * Special-slug resolution, decoding, and excludeIDs parsing are adapter
 * internals covered by the adapter's own unit tests.
 */
const makeQueryHarness = ({
	coordinators = [{ normalizedEmail: "coordinator@example.com", excludedPlatformIds: [] }],
	callerEmail = "coordinator@example.com",
	streamDoc = mockCastrStreamData,
}: QueryHarnessOptions = {}) => {
	const aclFake = {
		loadFreshBySlug: mock((campusSlug: string) =>
			Effect.succeed({
				campusSlug,
				streamId: "stream-123",
				coordinators: coordinators.map((coordinator) => ({
					normalizedEmail: coordinator.normalizedEmail,
					excludedPlatformIds: new Set(coordinator.excludedPlatformIds),
					canEditMetadata: true,
				})),
			}),
		),
	};

	const storeFake = {
		getStream: mock((_streamId: string) => Effect.succeed(streamDoc)),
	};

	const runner = (<A, E, R>(program: Effect.Effect<A, E, R>) =>
		Effect.runPromise(
			(program as Effect.Effect<A>).pipe(
				Effect.provideService(StrapiStreamAclProvider, aclFake as never),
				Effect.provideService(StreamProjectionStore, storeFake as never),
			),
		)) as never;

	const context = createMockContext({
		currentUserUid: "test-user-uid-123",
		currentUserEmail: callerEmail,
		authorized: true,
		authType: "jwt",
		effectRunPromise: runner,
	});

	return { context };
};

describe("castrStream query", () => {
	const CASTR_STREAM_QUERY = `
		query CastrStreamQuery($campusSlug: String!) {
			castrStream(campusSlug: $campusSlug) {
				id
				name
				enabled
				broadcasting_status
				title
				description
				platforms {
					id
					name
					enabled
					broadcasting_status
				}
			}
		}
	`;

	it("returns null (not an error) for a signed-in user with no matching coordinator", async () => {
		// Characterization for docs/streaming-migration-implementation-v3.md
		// (Phase A step 1): resource-ACL denial and not-found are both `null`
		// for a signed-in caller — indistinguishable on the wire, by design.
		// Only transport-auth failures produce GraphQL errors.
		const { context } = makeQueryHarness({
			coordinators: [{ normalizedEmail: "someone-else@example.com", excludedPlatformIds: [] }],
			callerEmail: "not-a-coordinator@example.com",
		});

		const result = await executeGraphQL<{ castrStream: unknown }>(CASTR_STREAM_QUERY, context, {
			campusSlug: "house-of-stars",
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.castrStream).toBeNull();
	});

	it("should exclude platform ids the matching coordinator is excluded from", async () => {
		const { context } = makeQueryHarness({
			coordinators: [
				{ normalizedEmail: "coordinator@example.com", excludedPlatformIds: ["platform-2"] },
			],
		});

		const result = await executeGraphQL<{
			castrStream: { platforms: { id: string }[] };
		}>(CASTR_STREAM_QUERY, context, {
			campusSlug: "house-of-stars",
		});

		expect(isAuthError(result)).toBe(false);
		expect(result.data?.castrStream.platforms.map((platform) => platform.id)).toEqual([
			"platform-1",
		]);
	});

	it("only applies exclusions from coordinators matching the caller", async () => {
		// Mirrors the previous special-slug scenario: another coordinator's
		// exclusions must not restrict the caller's view.
		const { context } = makeQueryHarness({
			coordinators: [
				{ normalizedEmail: "other@example.com", excludedPlatformIds: ["platform-1"] },
				{ normalizedEmail: "coordinator@example.com", excludedPlatformIds: ["platform-2"] },
			],
		});

		const result = await executeGraphQL<{
			castrStream: { platforms: { id: string }[] };
		}>(CASTR_STREAM_QUERY, context, {
			campusSlug: "house-of-stars-junior-church",
		});

		expect(isAuthError(result)).toBe(false);
		expect(result.data?.castrStream.platforms.map((platform) => platform.id)).toEqual([
			"platform-1",
		]);
	});

	it("marks Instagram destinations that are off as needing a new stream key", async () => {
		// Instagram issues a new key for every broadcast, so starting one needs a fresh paste.
		const streamDoc = structuredClone(mockCastrStreamData);
		streamDoc.platforms.push(
			{
				id: "platform-3",
				name: "Instagram",
				enabled: false,
				template: "instagram",
				broadcasting_status: "offline",
				key: "example-saved-key",
			},
			{
				id: "platform-4",
				name: "Instagram Live",
				enabled: true,
				template: "Instagram-Live",
				broadcasting_status: "offline",
				key: "example-live-key",
			},
		);
		const { context } = makeQueryHarness({ streamDoc });

		const result = await executeGraphQL<{
			castrStream: { platforms: { id: string; requiresNewStreamKey: boolean | null }[] };
		}>(
			`query CastrStreamQuery($campusSlug: String!) {
				castrStream(campusSlug: $campusSlug) {
					platforms {
						id
						requiresNewStreamKey
					}
				}
			}`,
			context,
			{ campusSlug: "house-of-stars" },
		);

		expect(result.errors).toBeUndefined();
		expect(
			Object.fromEntries(
				(result.data?.castrStream.platforms ?? []).map((platform) => [
					platform.id,
					platform.requiresNewStreamKey,
				]),
			),
		).toEqual({
			"platform-1": false,
			"platform-2": false,
			"platform-3": true,
			"platform-4": false,
		});
	});
});
