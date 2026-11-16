import { sentry } from "@/graphql/__tests__/utils/sentry-mocks";
import { omitUndefined } from "@/utils/omitUndefined";
import { CASTR_Response, CASTRRequestType, CastrPatchError } from "@hccnj/castr";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect } from "effect";
import { execute, parse } from "graphql";

import type { StreamEventState } from "@/effect/services/stream/notification";
import type { patchCastrPlatformEffect } from "@/utils/castr";
import type { Message } from "firebase-admin/messaging";

type PatchCastrPlatformInput = Parameters<typeof patchCastrPlatformEffect>[0];

const mockPatchCastrPlatformEffect = mock(
	(_input: PatchCastrPlatformInput): Effect.Effect<unknown, CastrPatchError> =>
		Effect.succeed({ ok: true }),
);

// Module mocks must be before any imports that use them. The firebase mock
// only prevents real SDK initialization during schema import — the castr
// resolvers no longer touch Firestore directly (they go through
// StreamProjectionStore, faked per test below).
void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	db: {
		collection: mock(() => ({
			doc: mock(() => ({
				// oxlint-disable-next-line no-null
				get: mock(() => Promise.resolve({ exists: false, data: () => null })),
				set: mock(() => Promise.resolve()),
				update: mock(() => Promise.resolve()),
			})),
		})),
		runTransaction: mock(
			<T>(
				callback: (tx: {
					get: () => Promise<{ exists: boolean; data: () => null }>;
					set: () => void;
				}) => Promise<T>,
			) =>
				callback({
					// oxlint-disable-next-line no-null
					get: () => Promise.resolve({ exists: false, data: () => null }),
					set: () => {},
				}),
		),
	},
	secondaryDb: {},
	dbFieldValue: {},
	fieldPath: {},
	FBPaths: {},
	getStorageBucket: mock(),
	AppCollections: {
		users: "app-users",
		config: "app-config",
		liveStreamDoc: "live-stream",
		castrStreams: "castr-streams",
	},
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

void mock.module("@/utils/castr", () => ({
	CASTRRequestType,
	CASTR_Response,
	getCastrLiveStreamsEffect: Effect.succeed({ docs: [] }),
	patchCastrPlatformEffect: mockPatchCastrPlatformEffect,
}));

// Import schema and services after mocks are set up
const { schema } = await import("@/graphql/schema");
const { AppConfig } = await import("@/effect/AppConfig");
const { StreamMappingService } = await import("@/effect/services/StreamMappingService");
const { StrapiStreamAclProvider } = await import("@/effect/services/StrapiStreamAclProvider");
const { StreamAuthorizationServiceLive } =
	await import("@/effect/services/StreamAuthorizationService");
const { StreamProjectionStore } = await import("@/effect/services/StreamProjectionStore");
const { Layer } = await import("effect");
const { createMockContext } = await import("../utils/test-context");

const mockCastrStreamData = {
	id: "stream-123",
	name: "House of Stars Stream",
	enabled: true,
	broadcasting_status: "offline" as const,
	title: "Sunday Service",
	description: "Live Sunday Service",
	last_updated: new Date("2026-03-05T00:00:00.000Z"),
	platforms: [
		{
			id: "platform-1",
			name: "YouTube",
			enabled: true,
			template: "youtube",
			server: "rtmp://youtube.example.com",
			key: "stream-key-123",
			broadcasting_status: "offline" as const,
		},
		{
			id: "platform-2",
			name: "Facebook",
			enabled: true,
			template: "facebook",
			server: "rtmp://facebook.example.com",
			key: "stream-key-456",
			broadcasting_status: "offline" as const,
		},
	],
};

const { FirebaseAdminService } = await import("@/effect/services/FirebaseAdminService");
const { hasDestinationOn, planStreamEvent } = await import("@/effect/services/stream/notification");

type StoredPlatformMetadata = Record<string, { title: string; description: string }>;

type MockStreamDoc = typeof mockCastrStreamData & { platformMetadata?: StoredPlatformMetadata };

type PlatformMetadataChange = { title: string; description: string } | null;

interface MetadataWriteInput {
	streamId: string;
	title: string;
	description: string;
	platformMetadataChanges: ReadonlyMap<string, PlatformMetadataChange>;
	lastUpdated: Date;
	notificationCampusSlug?: string;
	platformEnabledChanges: ReadonlyMap<string, boolean>;
}

/** Recorded with the change sets as plain objects for readable assertions. */
interface RecordedMetadataWrite extends Omit<
	MetadataWriteInput,
	"platformMetadataChanges" | "platformEnabledChanges"
> {
	platformMetadataChanges: Record<string, PlatformMetadataChange>;
	platformEnabledChanges: Record<string, boolean>;
}

interface RecordedLiveStatusWrite {
	streamId: string;
	isLive: boolean;
}

interface HarnessOptions {
	excludedPlatformIds?: string[];
	canEditMetadata?: boolean;
	unauthorizedPlatformPolicy?: "filter" | "reject";
	streamDoc?: MockStreamDoc | undefined;
	campusStreamNotificationsEnabled?: boolean;
}

/**
 * Builds a resolver harness with fakes at the service seams the resolver now
 * depends on: the Strapi ACL adapter, the Firestore projection store, and the
 * stream-mapping (reconciliation poll) service — provided through the
 * request-scoped Effect runner exactly as the production runtime provides the
 * real implementations.
 */
const makeHarness = ({
	excludedPlatformIds = [],
	canEditMetadata = true,
	unauthorizedPlatformPolicy = "filter",
	streamDoc = mockCastrStreamData,
	campusStreamNotificationsEnabled = true,
}: HarnessOptions = {}) => {
	const sendMessage = mock((_message: Message) => Effect.succeed("message"));
	// The stream's persisted event, carried across saves like the Firestore document.
	let eventState: StreamEventState = {
		eventStartedAt: undefined,
		eventEndedAt: undefined,
		notifiedAt: undefined,
		notifiedFingerprint: undefined,
		revision: 0,
	};
	const metadataWrites: RecordedMetadataWrite[] = [];
	const liveStatusWrites: RecordedLiveStatusWrite[] = [];

	const aclFake = {
		loadFreshBySlug: mock((campusSlug: string) =>
			Effect.succeed({
				campusSlug,
				streamId: "stream-123",
				coordinators: [
					{
						normalizedEmail: "coordinator@example.com",
						excludedPlatformIds: new Set(excludedPlatformIds),
						canEditMetadata,
					},
				],
			}),
		),
	};

	const storeFake = {
		getStream: mock((_streamId: string) => Effect.succeed(streamDoc)),
		updateStreamMetadata: mock((input: MetadataWriteInput) => {
			metadataWrites.push({
				...input,
				platformMetadataChanges: Object.fromEntries(input.platformMetadataChanges),
				platformEnabledChanges: Object.fromEntries(input.platformEnabledChanges),
			});
			const streamIsLive = hasDestinationOn(
				streamDoc?.platforms ?? [],
				input.platformEnabledChanges,
			);
			const plan = planStreamEvent({
				previous: eventState,
				live: streamIsLive,
				now: input.lastUpdated,
				campusSlug: input.notificationCampusSlug,
				streamId: input.streamId,
				title: input.title,
				description: input.description,
			});
			eventState = plan.state;
			return Effect.succeed({ notification: plan.notification, streamIsLive });
		}),
		setLiveStatus: mock((input: RecordedLiveStatusWrite) => {
			liveStatusWrites.push(input);
			return Effect.void;
		}),
	};

	const pollFake = {
		updateStreamMapping: mock(() => Effect.void),
	};

	// The REAL authorization service runs over the ACL fake so resolver tests
	// exercise genuine grant derivation; policy "filter" mirrors production's
	// default config.
	const appConfigFake = { streamEdit: { unauthorizedPlatformPolicy } };
	const authorizationLayer = StreamAuthorizationServiceLive.pipe(
		Layer.provide(Layer.succeed(StrapiStreamAclProvider, aclFake as never)),
		Layer.provide(Layer.succeed(AppConfig, appConfigFake as never)),
	);
	const runner = (<A, E, R>(program: Effect.Effect<A, E, R>) =>
		Effect.runPromise(
			(program as Effect.Effect<A>).pipe(
				Effect.provide(authorizationLayer),
				Effect.provideService(StrapiStreamAclProvider, aclFake as never),
				Effect.provideService(StreamProjectionStore, storeFake as never),
				Effect.provideService(FirebaseAdminService, { sendMessage } as never),
				Effect.provideService(StreamMappingService, pollFake as never),
			),
		)) as never;

	const context = createMockContext({
		currentUserUid: "test-user-uid-123",
		currentUserEmail: "coordinator@example.com",
		authorized: true,
		authType: "jwt",
		effectRunPromise: runner,
		checkGate: (gate) =>
			gate === "campus_stream_notifications_enabled" ? campusStreamNotificationsEnabled : true,
	});

	return {
		context,
		sendMessage,
		aclFake,
		pollFake,
		metadataWrites,
		liveStatusWrites,
	};
};

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

const UPDATE_CASTR_STREAM_MUTATION = `
	mutation UpdateCastrStream($input: UpdateCastrStreamInput!) {
		updateCastrStream(input: $input) {
			message
		}
	}
`;

const makeInput = (
	platforms: {
		id: string;
		broadcasting_status: "online" | "offline";
		key?: string;
		title?: string | null;
		description?: string | null;
	}[],
	overrides: { streamId?: string; title?: string; description?: string; campusSlug?: string } = {},
) => ({
	input: {
		campusSlug: overrides.campusSlug ?? "house-of-stars",
		streamId: overrides.streamId ?? "stream-123",
		title: overrides.title ?? "Updated Service Title",
		description: overrides.description ?? "Updated service description",
		platforms,
	},
});

describe("updateCastrStream mutation", () => {
	beforeEach(() => {
		mockPatchCastrPlatformEffect.mockClear();
		mockPatchCastrPlatformEffect.mockImplementation(() => Effect.succeed({ ok: true }));
	});

	it("should only update channels the coordinator is associated with", async () => {
		const { context, aclFake, metadataWrites, liveStatusWrites } = makeHarness({
			excludedPlatformIds: ["platform-2"],
		});

		const result = await executeGraphQL<{
			updateCastrStream: { message: string };
		}>(
			UPDATE_CASTR_STREAM_MUTATION,
			context,
			makeInput([
				{ id: "platform-1", broadcasting_status: "online" },
				{ id: "platform-2", broadcasting_status: "online" },
			]),
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.updateCastrStream.message).toBe("Castr stream updated");
		expect(aclFake.loadFreshBySlug).toHaveBeenCalledWith("house-of-stars");
		expect(mockPatchCastrPlatformEffect).toHaveBeenCalledTimes(1);
		const [firstPatchCall] = mockPatchCastrPlatformEffect.mock.calls;

		expect(firstPatchCall?.[0]).toMatchObject({
			streamId: "stream-123",
			platformId: "platform-1",
		});
		expect(metadataWrites[0]).toMatchObject({
			streamId: "stream-123",
			title: "Updated Service Title",
			description: "Updated service description",
		});
		expect(metadataWrites[0]?.lastUpdated).toBeInstanceOf(Date);
		expect(liveStatusWrites).toEqual([{ streamId: "stream-123", isLive: true }]);
	});

	it("rejects a mismatched streamId before any provider call", async () => {
		const { context, metadataWrites } = makeHarness();

		const result = await executeGraphQL(
			UPDATE_CASTR_STREAM_MUTATION,
			context,
			makeInput([{ id: "platform-1", broadcasting_status: "online" }], {
				streamId: "some-other-stream",
			}),
		);

		expect(result.errors?.[0]?.message).toBe("Castr stream not found");
		expect(mockPatchCastrPlatformEffect).not.toHaveBeenCalled();
		expect(metadataWrites).toHaveLength(0);
	});

	it("reports which destination Castr rejected while saving the rest", async () => {
		sentry.captureException.mockClear();
		mockPatchCastrPlatformEffect.mockImplementation(({ platformId }) =>
			platformId === "platform-2"
				? Effect.fail(
						new CastrPatchError({
							message: "Castr API error: 500 Internal Server Error",
							status: 500,
							body: '{ "message": "Example upstream failure" }',
						}),
					)
				: Effect.succeed({ ok: true }),
		);
		const { context } = makeHarness();

		const result = await executeGraphQL<{
			updateCastrStream: { message: string };
		}>(
			UPDATE_CASTR_STREAM_MUTATION,
			context,
			makeInput([
				{ id: "platform-1", broadcasting_status: "online" },
				{ id: "platform-2", broadcasting_status: "online" },
			]),
		);

		// Deployed apps treat a partial failure as success; keep that response.
		expect(result.errors).toBeUndefined();
		expect(result.data?.updateCastrStream.message).toBe("Castr stream updated");
		expect(sentry.captureException).toHaveBeenCalledTimes(1);
		const [reported, captureContext] = sentry.captureException.mock.calls[0] ?? [];
		expect((reported as Error).message).toBe(
			"Partial Castr stream update failure: 1 platform(s) failed",
		);
		expect(captureContext).toEqual({
			tags: { "castr.stream_id": "stream-123", "castr.failed_templates": "facebook" },
			extra: {
				failedPlatformUpdates: [
					{
						platformId: "platform-2",
						name: "Facebook",
						template: "facebook",
						enabled: true,
						error: "Castr API error: 500 Internal Server Error",
						status: 500,
						body: '{ "message": "Example upstream failure" }',
					},
				],
			},
		});
	});

	it.each(["youtube", "Facebook Live", "custom", ""])(
		"continues omitting stream keys for non-Instagram template %s",
		async (template) => {
			const streamDoc = structuredClone(mockCastrStreamData);
			for (const platform of streamDoc.platforms) {
				platform.template = template;
			}
			const { context } = makeHarness({ streamDoc });
			const result = await executeGraphQL(
				UPDATE_CASTR_STREAM_MUTATION,
				context,
				makeInput([
					{ id: "platform-1", broadcasting_status: "online", key: "example-ignored-key" },
				]),
			);
			expect(result.errors).toBeUndefined();
			expect(mockPatchCastrPlatformEffect).toHaveBeenCalledTimes(1);
			expect(mockPatchCastrPlatformEffect.mock.calls[0]?.[0].data).not.toHaveProperty("key");
		},
	);
});

type PlatformInput = Parameters<typeof makeInput>[0][number];

const UPDATE_CASTR_STREAM_WITH_SKIPS_MUTATION = `
	mutation UpdateCastrStream($input: UpdateCastrStreamInput!) {
		updateCastrStream(input: $input) {
			message
			skippedPlatformIds
		}
	}
`;

interface UpdateWithSkipsResult {
	updateCastrStream: { message: string; skippedPlatformIds: string[] | null };
}

describe("Instagram stream keys", () => {
	// Instagram issues a new key for every broadcast, so the saved key is spent.
	const streamWithInstagram = (instagramEnabled: boolean, platformIds: string[]) => {
		const streamDoc = structuredClone(mockCastrStreamData);
		streamDoc.platforms.push({
			id: "platform-3",
			name: "Instagram",
			enabled: instagramEnabled,
			template: "instagram",
			server: "rtmps://instagram.example.com",
			key: "example-saved-key",
			broadcasting_status: "offline",
		});
		streamDoc.platforms = streamDoc.platforms.filter((platform) =>
			platformIds.includes(platform.id),
		);
		return streamDoc;
	};

	const instagramPatch = () => {
		const data = mockPatchCastrPlatformEffect.mock.calls.find(
			([input]) => input.platformId === "platform-3",
		)?.[0].data;
		return data && omitUndefined({ enabled: data.enabled, key: data.key });
	};

	beforeEach(() => {
		mockPatchCastrPlatformEffect.mockClear();
		mockPatchCastrPlatformEffect.mockImplementation(() => Effect.succeed({ ok: true }));
	});

	it.each([
		{
			change: "starts with a new key",
			wasEnabled: false,
			status: "online",
			key: "example-new-key",
			sent: { enabled: true, key: "example-new-key" },
		},
		{
			change: "is skipped when starting with the saved key",
			wasEnabled: false,
			status: "online",
			key: "example-saved-key",
			sent: undefined,
		},
		{
			change: "is skipped when starting without a key",
			wasEnabled: false,
			status: "online",
			key: undefined,
			sent: undefined,
		},
		{
			change: "stays live without resending the saved key",
			wasEnabled: true,
			status: "online",
			key: "example-saved-key",
			sent: { enabled: true },
		},
		{
			change: "stays live with a replacement key",
			wasEnabled: true,
			status: "online",
			key: "example-new-key",
			sent: { enabled: true, key: "example-new-key" },
		},
		{
			change: "ends without sending a key",
			wasEnabled: true,
			status: "offline",
			key: "example-saved-key",
			sent: { enabled: false },
		},
	] as const)("Instagram $change", async ({ wasEnabled, status, key, sent }) => {
		const { context } = makeHarness({
			streamDoc: streamWithInstagram(wasEnabled, ["platform-1", "platform-3"]),
		});

		const instagram: PlatformInput = {
			id: "platform-3",
			broadcasting_status: status,
		};
		if (key) {
			instagram.key = key;
		}

		const result = await executeGraphQL<UpdateWithSkipsResult>(
			UPDATE_CASTR_STREAM_WITH_SKIPS_MUTATION,
			context,
			makeInput([{ id: "platform-1", broadcasting_status: status }, instagram]),
		);

		expect(result.errors).toBeUndefined();
		expect(instagramPatch()).toEqual(sent);
		// The response names every skipped destination so the app can say so.
		expect(result.data?.updateCastrStream.skippedPlatformIds).toEqual(
			sent === undefined ? ["platform-3"] : [],
		);
		// Other destinations save either way.
		expect(
			mockPatchCastrPlatformEffect.mock.calls.some(([input]) => input.platformId === "platform-1"),
		).toBe(true);
	});

	it("saves the stream details when the only start is a skipped Instagram", async () => {
		const { context, metadataWrites } = makeHarness({
			streamDoc: streamWithInstagram(false, ["platform-3"]),
		});

		const result = await executeGraphQL<{ updateCastrStream: { message: string } }>(
			UPDATE_CASTR_STREAM_MUTATION,
			context,
			makeInput([{ id: "platform-3", broadcasting_status: "online", key: "example-saved-key" }]),
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.updateCastrStream.message).toBe("Castr stream updated");
		expect(mockPatchCastrPlatformEffect).not.toHaveBeenCalled();
		expect(metadataWrites).toHaveLength(1);
	});

	it("ends the stream when everything sent goes offline beside a skipped Instagram start", async () => {
		const { context, pollFake } = makeHarness({
			streamDoc: streamWithInstagram(false, ["platform-1", "platform-3"]),
		});

		const result = await executeGraphQL(
			UPDATE_CASTR_STREAM_MUTATION,
			context,
			makeInput([
				{ id: "platform-1", broadcasting_status: "offline" },
				{ id: "platform-3", broadcasting_status: "online", key: "example-saved-key" },
			]),
		);

		expect(result.errors).toBeUndefined();
		// Nothing is live after this save, so the poll must treat it as ended.
		expect(pollFake.updateStreamMapping).toHaveBeenCalledWith(
			expect.objectContaining({ isEndingStream: true }),
		);
	});
});

describe("per-destination title and description", () => {
	const storedOverride = {
		"platform-1": { title: "YouTube title", description: "YouTube description" },
	};

	beforeEach(() => {
		mockPatchCastrPlatformEffect.mockClear();
		mockPatchCastrPlatformEffect.mockImplementation(() => Effect.succeed({ ok: true }));
	});

	const patchedMetadataByPlatform = () =>
		Object.fromEntries(
			mockPatchCastrPlatformEffect.mock.calls.map(([input]) => [
				input.platformId,
				input.data.metadata,
			]),
		);

	it("keeps a saved override when an older app omits the destination fields", async () => {
		const { context, metadataWrites } = makeHarness({
			streamDoc: { ...mockCastrStreamData, platformMetadata: storedOverride },
		});

		const result = await executeGraphQL(
			UPDATE_CASTR_STREAM_MUTATION,
			context,
			makeInput([
				{ id: "platform-1", broadcasting_status: "online" },
				{ id: "platform-2", broadcasting_status: "online" },
			]),
		);

		expect(result.errors).toBeUndefined();
		expect(patchedMetadataByPlatform()).toEqual({
			"platform-1": { title: "YouTube title", description: "YouTube description" },
			"platform-2": {
				title: "Updated Service Title",
				description: "Updated service description",
			},
		});
		// Omitted fields record no change, so a stale read can't undo a newer save.
		expect(metadataWrites[0]?.platformMetadataChanges).toEqual({});
	});

	it("treats a destination override change as a metadata change for authorization", async () => {
		const { context } = makeHarness({
			canEditMetadata: false,
			unauthorizedPlatformPolicy: "reject",
		});

		const result = await executeGraphQL(
			UPDATE_CASTR_STREAM_MUTATION,
			context,
			makeInput(
				[
					{
						id: "platform-1",
						broadcasting_status: "online",
						title: "YouTube title",
						description: "YouTube description",
					},
				],
				{ title: mockCastrStreamData.title, description: mockCastrStreamData.description },
			),
		);

		expect(result.errors?.[0]?.message).toBe("Castr stream not found");
		expect(mockPatchCastrPlatformEffect).not.toHaveBeenCalled();
	});
});

const sentTitles = (sendMessage: ReturnType<typeof makeHarness>["sendMessage"]) =>
	sendMessage.mock.calls.map(([message]) => message.notification?.title);

describe("campus stream notifications", () => {
	beforeEach(() => {
		mockPatchCastrPlatformEffect.mockClear();
		mockPatchCastrPlatformEffect.mockImplementation(() => Effect.succeed({ ok: true }));
	});

	const live = [
		{ id: "platform-1", broadcasting_status: "online" as const },
		{ id: "platform-2", broadcasting_status: "online" as const },
	];
	const save = (
		context: Parameters<typeof execute>[0]["contextValue"],
		platforms: Parameters<typeof makeInput>[0],
		title: string,
	) =>
		executeGraphQL(
			UPDATE_CASTR_STREAM_MUTATION,
			context,
			makeInput(platforms, {
				campusSlug: "new-breed",
				title,
				description: "Follow us on social media",
			}),
		);

	it("notifies the campus once for a live title change, however often it is corrected", async () => {
		const { context, sendMessage, metadataWrites } = makeHarness();

		await save(context, live, "Galatians III | Refresh");
		await save(context, live, "Galatians III | Refresh | Oct 14th");

		expect(metadataWrites[0]?.notificationCampusSlug).toBe("new-breed");
		// One event, sent once to each of the campus's two audiences.
		expect(sentTitles(sendMessage)).toEqual(["Galatians III | Refresh", "Galatians III | Refresh"]);
	});

	it("records a save that turns every destination off as the end of the event", async () => {
		const { context, sendMessage, pollFake } = makeHarness();

		await save(
			context,
			[
				{ id: "platform-1", broadcasting_status: "offline" },
				{ id: "platform-2", broadcasting_status: "offline" },
			],
			"Next week's service",
		);

		expect(pollFake.updateStreamMapping).toHaveBeenCalledWith(
			expect.objectContaining({ isEndingStream: true }),
		);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("keeps the event live when a coordinator turns off only the destinations they manage", async () => {
		// platform-2 belongs to another coordinator and stays on.
		const { context, metadataWrites, pollFake } = makeHarness({
			excludedPlatformIds: ["platform-2"],
		});

		await save(context, [{ id: "platform-1", broadcasting_status: "offline" }], "Sunday service");

		expect(metadataWrites[0]?.platformEnabledChanges).toEqual({ "platform-1": false });
		// Reconciliation must not record platform-2 as disabled either, or the next save would end the event.
		expect(pollFake.updateStreamMapping).toHaveBeenCalledWith(
			expect.objectContaining({ isEndingStream: false }),
		);
	});

	it("ends the event when the last destination left on is turned off, whatever Castr last reported", async () => {
		const streamDoc = structuredClone(mockCastrStreamData);
		const [, other] = streamDoc.platforms;
		if (other) {
			// Turned off, but the projection still holds Castr's last "online" report.
			Object.assign(other, { enabled: false, broadcasting_status: "online" });
		}
		const { context, sendMessage, pollFake } = makeHarness({
			streamDoc,
			excludedPlatformIds: ["platform-2"],
		});

		await save(context, [{ id: "platform-1", broadcasting_status: "offline" }], "Sunday service");

		expect(pollFake.updateStreamMapping).toHaveBeenCalledWith(
			expect.objectContaining({ isEndingStream: true }),
		);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("ends the stream when Castr accepts the last stop and rejects a start in the same save", async () => {
		const streamDoc = structuredClone(mockCastrStreamData);
		const [, other] = streamDoc.platforms;
		if (other) {
			Object.assign(other, { enabled: false });
		}
		mockPatchCastrPlatformEffect.mockImplementation(({ platformId }) =>
			platformId === "platform-2"
				? Effect.fail(
						new CastrPatchError({
							message: "Castr API error: 500 Internal Server Error",
							status: 500,
							body: '{ "message": "Example upstream failure" }',
						}),
					)
				: Effect.succeed({ ok: true }),
		);
		const { context, pollFake } = makeHarness({ streamDoc });

		await save(
			context,
			[
				{ id: "platform-1", broadcasting_status: "offline" },
				{ id: "platform-2", broadcasting_status: "online" },
			],
			"Sunday service",
		);

		expect(pollFake.updateStreamMapping).toHaveBeenCalledWith(
			expect.objectContaining({ isEndingStream: true }),
		);
	});

	it("tracks the event without notifying other campuses while the rollout gate is off", async () => {
		const { context, sendMessage, metadataWrites } = makeHarness({
			campusStreamNotificationsEnabled: false,
		});

		await save(context, live, "Galatians III | Refresh");

		expect(metadataWrites[0]?.notificationCampusSlug).toBeUndefined();
		expect(sendMessage).not.toHaveBeenCalled();
	});
});
