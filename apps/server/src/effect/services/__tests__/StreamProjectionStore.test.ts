import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import {
	StreamProjectionStore,
	StreamProjectionStoreLive,
} from "@/effect/services/StreamProjectionStore";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { Timestamp, type DocumentData } from "firebase-admin/firestore";

const makeFirestore = (get: () => Promise<{ data: () => DocumentData | undefined }>) => {
	const doc = mock((_docId: string) => ({ get }));
	const collection = mock((_collectionId: string) => ({ doc }));
	return { db: { collection }, collection, doc };
};

const getLiveStreams = (firestore: ReturnType<typeof makeFirestore>) => {
	const firebaseLayer = Layer.succeed(FirebaseAdminContext, {
		db: firestore.db,
		AppCollections: { config: "app-config", liveStreamDoc: "live-stream" },
	} as never);
	return Effect.gen(function* () {
		const store = yield* StreamProjectionStore;
		return yield* store.getLiveStreams();
	}).pipe(Effect.provide(StreamProjectionStoreLive.pipe(Layer.provide(firebaseLayer))));
};

/** Omit `data` to model a missing document, whose snapshot data is undefined. */
const withData = (data?: DocumentData) =>
	makeFirestore(() => Promise.resolve({ data: () => data }));

describe("StreamProjectionStore.getLiveStreams", () => {
	it("reads the streams from app-config/live-stream and drops legacy fields", async () => {
		const firestore = withData({
			isLive: true,
			streamUrl: "https://example.com/legacy",
			campusLiveStatus: { "house-of-stars": true },
			streams: [
				{ id: "stream-1", slug: "house-of-stars", isLive: true },
				{ id: "stream-2", isLive: false },
			],
		});

		const streams = await Effect.runPromise(getLiveStreams(firestore));

		expect(streams).toEqual([
			{ id: "stream-1", slug: "house-of-stars", isLive: true },
			{ id: "stream-2", isLive: false },
		]);
		expect(firestore.collection).toHaveBeenCalledWith("app-config");
		expect(firestore.doc).toHaveBeenCalledWith("live-stream");
	});

	it("returns no streams when the document does not exist", async () => {
		const streams = await Effect.runPromise(getLiveStreams(withData()));

		expect(streams).toEqual([]);
	});

	it("returns no streams when the document has no streams field", async () => {
		const streams = await Effect.runPromise(getLiveStreams(withData({ isLive: false })));

		expect(streams).toEqual([]);
	});

	it("fails with LiveStreamConfigReadError when the document is malformed", async () => {
		const firestore = withData({ streams: [{ id: 1, isLive: "yes" }] });

		const error = await Effect.runPromise(Effect.flip(getLiveStreams(firestore)));

		expect(error._tag).toBe("LiveStreamConfigReadError");
	});

	it("fails with LiveStreamConfigReadError when Firestore rejects", async () => {
		const firestore = makeFirestore(() => Promise.reject(new Error("UNAVAILABLE")));

		const error = await Effect.runPromise(Effect.flip(getLiveStreams(firestore)));

		expect(error._tag).toBe("LiveStreamConfigReadError");
	});

	it.each([null, "legacy", { "stream-1": { title: 42, description: "Invalid title" } }])(
		"preserves live status when aggregate metadata is malformed: %p",
		async (metadataByStreamId) => {
			const streams = [{ id: "stream-1", isLive: true }];
			const firestore = withData({ streams, metadataByStreamId });
			expect(await Effect.runPromise(getLiveStreams(firestore))).toEqual(streams);
		},
	);

	it("decodes aggregate metadata per stream and preserves empty strings", async () => {
		const firestore = withData({
			streams: [
				{ id: "stream-1", isLive: true },
				{ id: "stream-2", isLive: false },
			],
			metadataByStreamId: {
				"stream-1": { title: "", description: "" },
				"stream-2": null,
			},
		});
		expect(await Effect.runPromise(getLiveStreams(firestore))).toEqual([
			{ id: "stream-1", isLive: true, metadata: { title: "", description: "" } },
			{ id: "stream-2", isLive: false },
		]);
	});
});

// Firestore hands back every stored Date as a Timestamp.
const readBack = (value: DocumentData[string]) => {
	if (value instanceof Date) {
		return Timestamp.fromDate(value);
	}
	return value instanceof Timestamp ? value : structuredClone(value);
};
const clone = (data: DocumentData | undefined) =>
	data && Object.fromEntries(Object.entries(data).map(([key, value]) => [key, readBack(value)]));

const makeMetadataHarness = (initialDocuments: Record<string, DocumentData> = {}) => {
	const documents = new Map(Object.entries(initialDocuments));
	const snapshot = (id: string) => {
		const data = clone(documents.get(id));
		return { exists: data !== undefined, data: () => data };
	};
	const read = mock((id: string) => Promise.resolve(snapshot(id)));
	const transaction = (pending: Map<string, DocumentData>) => ({
		get: ({ id }: { id: string }) => Promise.resolve(snapshot(id)),
		update: ({ id }: { id: string }, data: DocumentData) => {
			pending.set(id, { ...pending.get(id), ...data });
		},
		set: ({ id }: { id: string }, data: DocumentData, options: { merge: boolean }) => {
			expect(options.merge).toBe(true);
			const current = pending.get(id);
			const merged = { ...current, ...data };
			if (data.metadataByStreamId) {
				merged.metadataByStreamId = { ...current?.metadataByStreamId, ...data.metadataByStreamId };
			}
			pending.set(id, merged);
		},
	});
	const commit = async <A>(body: (tx: ReturnType<typeof transaction>) => Promise<A>) => {
		const pending = new Map(documents);
		const result = await body(transaction(pending));
		for (const [id, data] of pending) {
			documents.set(id, data);
		}
		return result;
	};
	const runTransaction = mock(commit);
	const make = StreamProjectionStore.make.pipe(
		Effect.provideService(FirebaseAdminContext, {
			db: {
				collection: () => ({ doc: (id: string) => ({ id, get: () => read(id) }) }),
				runTransaction,
			},
			AppCollections: {
				castrStreams: "castr-streams",
				config: "app-config",
				liveStreamDoc: "live-stream",
				liveStreamStateDoc: "live-stream-state",
			},
		} as never),
	);
	return { documents, read, runTransaction, make, commit };
};

/** A save that Castr accepted switching the stream's only destination on or off. */
const switched = (on: boolean) => new Map([["platform-1", on]]);

describe("StreamProjectionStore.getCachedPublicMetadata", () => {
	it.each([
		{ data: undefined, expected: { title: undefined, description: undefined } },
		{ data: {}, expected: { title: undefined, description: undefined } },
		{
			data: { title: null, description: null },
			expected: { title: undefined, description: undefined },
		},
		{ data: { title: "", description: "" }, expected: { title: "", description: "" } },
		{
			data: { title: 42, description: "Service" },
			expected: { title: undefined, description: "Service" },
		},
	])("handles missing and legacy metadata: $data", async ({ data, expected }) => {
		const { make } = makeMetadataHarness(data === undefined ? {} : { "stream-1": data });

		const metadata = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				return yield* store.getCachedPublicMetadata("stream-1");
			}),
		);

		expect(metadata).toEqual(expected);
	});

	it("shares concurrent and repeated reads while keeping stream IDs separate", async () => {
		const first = { title: "Sunday Service", description: "Join us live" };
		const second = { title: "Youth Service", description: "Welcome" };
		const { make, read } = makeMetadataHarness({ "stream-1": first, "stream-2": second });

		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				const results = yield* Effect.all(
					[store.getCachedPublicMetadata("stream-1"), store.getCachedPublicMetadata("stream-1")],
					{ concurrency: "unbounded" },
				);
				expect(results).toEqual([first, first]);
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(first);
				expect(yield* store.getCachedPublicMetadata("stream-2")).toEqual(second);
			}),
		);

		expect(read.mock.calls).toEqual([["stream-1"], ["stream-2"]]);
	});

	it("expires metadata after five minutes without caching live status or authorization reads", async () => {
		const first = { title: "Morning Service", description: "Welcome" };
		const next = { title: "Evening Service", description: "Welcome back" };
		const { make, documents, read } = makeMetadataHarness({
			"stream-1": first,
			"live-stream": { streams: [{ id: "stream-1", isLive: true }] },
		});
		const clockLayer = TestClock.layer();

		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(first);
				expect(yield* store.getLiveStreams()).toEqual([{ id: "stream-1", isLive: true }]);
				documents.set("stream-1", next);
				documents.set("live-stream", { streams: [{ id: "stream-1", isLive: false }] });
				yield* TestClock.adjust("4 minutes");
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(first);
				expect(yield* store.getLiveStreams()).toEqual([{ id: "stream-1", isLive: false }]);
				expect(yield* store.getStream("stream-1")).toMatchObject(next);
				yield* TestClock.adjust("1 minute");
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(next);
			}).pipe(Effect.provide(clockLayer)),
		);

		expect(read).toHaveBeenCalledTimes(5);
	});

	it("retries after a failed read instead of caching the failure", async () => {
		const metadata = { title: "Sunday Service", description: "Join us" };
		const { make, read } = makeMetadataHarness({ "stream-1": metadata });
		read.mockRejectedValueOnce(new Error("UNAVAILABLE"));

		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				const error = yield* Effect.flip(store.getCachedPublicMetadata("stream-1"));
				expect(error._tag).toBe("StreamProjectionReadError");
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(metadata);
			}),
		);

		expect(read).toHaveBeenCalledTimes(2);
	});

	it("invalidates cached metadata after a successful save and preserves its notification", async () => {
		const first = { title: "Morning Service", description: "Welcome" };
		const next = { title: "Evening Service", description: "Welcome back" };
		const { make, read } = makeMetadataHarness({ "stream-1": first });

		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(first);
				const { notification } = yield* store.updateStreamMetadata({
					streamId: "stream-1",
					...next,
					platformMetadataChanges: new Map(),
					lastUpdated: new Date(),
					notificationCampusSlug: "house-of-stars",
					platformEnabledChanges: switched(true),
				});
				expect(notification).toMatchObject({
					title: next.title,
					streamId: "stream-1",
					revision: 1,
				});
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(next);
			}),
		);

		expect(read).toHaveBeenCalledTimes(2);
	});

	it("persists each stream event so later saves in the same event do not notify again", async () => {
		const { make, documents } = makeMetadataHarness({
			"stream-1": {
				title: "Sunday Service",
				description: "Welcome",
				notificationRevision: 11,
				notificationClaimedAt: Timestamp.fromDate(new Date("2026-10-11T14:00:00Z")),
			},
		});

		const revisions = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				const save = (title: string, at: string, live: boolean) =>
					store
						.updateStreamMetadata({
							streamId: "stream-1",
							title,
							description: "Welcome",
							platformMetadataChanges: new Map(),
							lastUpdated: new Date(at),
							notificationCampusSlug: "new-breed",
							platformEnabledChanges: switched(live),
						})
						.pipe(Effect.map(({ notification }) => notification?.revision));
				return [
					// The claim made before event tracking is the current event.
					yield* save("Sunday Service, corrected", "2026-10-11T14:30:00Z", true),
					yield* save("Galatians III", "2026-10-15T00:02:48Z", true),
					yield* save("Galatians III, corrected", "2026-10-15T00:10:00Z", true),
					yield* save("Galatians III, corrected", "2026-10-15T02:00:00Z", false),
					// Restarted after the grace period: a new event.
					yield* save("Night prayer", "2026-10-15T03:00:00Z", true),
					yield* save("Night prayer", "2026-10-15T04:00:00Z", false),
					// Restarted within the grace period: the same event.
					yield* save("Night prayer, part two", "2026-10-15T04:10:00Z", true),
				];
			}),
		);

		expect(revisions).toEqual([undefined, 12, undefined, undefined, 13, undefined, undefined]);
		expect(documents.get("stream-1")).toMatchObject({
			title: "Night prayer, part two",
			notificationRevision: 13,
			liveEventEndedAt: null,
		});
	});

	it("compares a claim made before fingerprints with the details saved since it", async () => {
		const { make } = makeMetadataHarness({
			"stream-1": {
				title: "Sunday Service",
				description: "Welcome",
				notificationRevision: 11,
				notificationClaimedAt: Timestamp.fromDate(new Date("2026-10-11T14:00:00Z")),
			},
		});

		const revisions = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				const save = (title: string, at: string, live: boolean) =>
					store
						.updateStreamMetadata({
							streamId: "stream-1",
							title,
							description: "Welcome",
							platformMetadataChanges: new Map(),
							lastUpdated: new Date(at),
							notificationCampusSlug: "house-of-stars",
							platformEnabledChanges: switched(live),
						})
						.pipe(Effect.map(({ notification }) => notification?.revision));
				return [
					// The next week reuses the details: no change, no notification.
					yield* save("Sunday Service", "2026-10-18T14:00:00Z", true),
					yield* save("Sunday Service", "2026-10-18T16:00:00Z", false),
					// New details saved offline still count when the stream goes live.
					yield* save("Galatians III", "2026-10-25T13:30:00Z", false),
					yield* save("Galatians III", "2026-10-25T14:00:00Z", true),
				];
			}),
		);

		expect(revisions).toEqual([undefined, undefined, undefined, 12]);
	});

	it.each([
		{ otherStoredOn: true, streamIsLive: true },
		{ otherStoredOn: false, streamIsLive: false },
	])(
		"applies a stop to the destinations stored at write time (other on: $otherStoredOn)",
		async ({ otherStoredOn, streamIsLive }) => {
			const stoppedAt = new Date("2026-10-18T16:00:00Z");
			const { make, documents } = makeMetadataHarness({
				"stream-1": {
					title: "Sunday Service",
					description: "Welcome",
					// The status poll stores each switch, including one another save just turned on.
					platforms: [
						{ id: "platform-1", enabled: true },
						{ id: "platform-2", enabled: otherStoredOn },
					],
				},
			});

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const store = yield* make;
					return yield* store.updateStreamMetadata({
						streamId: "stream-1",
						title: "Sunday Service",
						description: "Welcome",
						platformMetadataChanges: new Map(),
						lastUpdated: stoppedAt,
						platformEnabledChanges: switched(false),
					});
				}),
			);

			expect(result.streamIsLive).toBe(streamIsLive);
			// Only a save that leaves nothing on records the end of the event.
			expect(documents.get("stream-1")?.liveEventEndedAt).toEqual(streamIsLive ? null : stoppedAt);
		},
	);

	it("reloads the previous metadata when a save fails", async () => {
		const metadata = { title: "Sunday Service", description: "Welcome" };
		const { make, read, runTransaction } = makeMetadataHarness({ "stream-1": metadata });
		runTransaction.mockRejectedValueOnce(new Error("UNAVAILABLE"));

		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				yield* store.getCachedPublicMetadata("stream-1");
				const error = yield* Effect.flip(
					store.updateStreamMetadata({
						streamId: "stream-1",
						title: "Unsaved title",
						description: "Unsaved description",
						platformMetadataChanges: new Map(),
						lastUpdated: new Date(),
						platformEnabledChanges: new Map(),
					}),
				);
				expect(error._tag).toBe("StreamProjectionWriteError");
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(metadata);
			}),
		);

		expect(read).toHaveBeenCalledTimes(2);
	});

	it("publishes metadata atomically for another instance and preserves it across status writes", async () => {
		const first = { title: "Morning", description: "Welcome" };
		const next = { title: "Evening", description: "Welcome back" };
		const other = { title: "Youth", description: "Youth service" };
		const { make, read, documents } = makeMetadataHarness({
			"stream-1": first,
			"live-stream": {
				streams: [{ id: "stream-1", isLive: true }],
				metadataByStreamId: { "stream-2": other },
			},
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const writer = yield* make;
				const reader = yield* make;
				yield* reader.getCachedPublicMetadata("stream-1");
				yield* writer.updateStreamMetadata({
					streamId: "stream-1",
					...next,
					platformMetadataChanges: new Map(),
					lastUpdated: new Date(),
					platformEnabledChanges: new Map(),
				});
				expect(yield* reader.getLiveStreams()).toEqual([
					{ id: "stream-1", isLive: true, metadata: next },
				]);
				yield* writer.setLiveStatus({ streamId: "stream-1", isLive: false });
				expect(yield* reader.getLiveStreams()).toEqual([
					{ id: "stream-1", isLive: false, metadata: next },
				]);
				expect(documents.get("live-stream")?.metadataByStreamId).toEqual({
					"stream-1": next,
					"stream-2": other,
				});
			}),
		);
		expect(read.mock.calls).toEqual([["stream-1"], ["live-stream"], ["live-stream"]]);
	});

	it("invalidates a legacy cache when a commit succeeds but its acknowledgment fails", async () => {
		const first = { title: "Morning", description: "Welcome" };
		const next = { title: "Evening", description: "Welcome back" };
		const { make, runTransaction, commit } = makeMetadataHarness({ "stream-1": first });
		runTransaction.mockImplementationOnce(async (body) => {
			await commit(body);
			throw new Error("DEADLINE_EXCEEDED");
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				yield* store.getCachedPublicMetadata("stream-1");
				yield* Effect.flip(
					store.updateStreamMetadata({
						streamId: "stream-1",
						...next,
						platformMetadataChanges: new Map(),
						lastUpdated: new Date(),
						platformEnabledChanges: new Map(),
					}),
				);
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(next);
			}),
		);
	});

	it("invalidates a legacy cache when the save is interrupted after commit", async () => {
		const first = { title: "Morning", description: "Welcome" };
		const next = { title: "Evening", description: "Welcome back" };
		const { make, runTransaction, commit } = makeMetadataHarness({ "stream-1": first });
		const committed = Promise.withResolvers<void>();
		const acknowledgment = Promise.withResolvers<void>();
		runTransaction.mockImplementationOnce(async (body) => {
			const result = await commit(body);
			committed.resolve();
			await acknowledgment.promise;
			return result;
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				yield* store.getCachedPublicMetadata("stream-1");
				const saving = yield* Effect.forkChild(
					store.updateStreamMetadata({
						streamId: "stream-1",
						...next,
						platformMetadataChanges: new Map(),
						lastUpdated: new Date(),
						platformEnabledChanges: new Map(),
					}),
				);
				yield* Effect.promise(() => committed.promise);
				yield* Fiber.interrupt(saving);
				acknowledgment.resolve();
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(next);
			}),
		);
	});

	it("does not repopulate invalidated metadata with an older in-flight read", async () => {
		const first = { title: "Morning", description: "Welcome" };
		const next = { title: "Evening", description: "Welcome back" };
		const { make, read } = makeMetadataHarness({ "stream-1": first });
		const started = Promise.withResolvers<void>();
		const heldRead = Promise.withResolvers<{ exists: boolean; data: () => DocumentData }>();
		read.mockImplementationOnce(() => {
			started.resolve();
			return heldRead.promise;
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* make;
				const reading = yield* Effect.forkChild(store.getCachedPublicMetadata("stream-1"));
				yield* Effect.promise(() => started.promise);
				yield* store.updateStreamMetadata({
					streamId: "stream-1",
					...next,
					platformMetadataChanges: new Map(),
					lastUpdated: new Date(),
					platformEnabledChanges: new Map(),
				});
				heldRead.resolve({ exists: true, data: () => first });
				expect(yield* Fiber.join(reading)).toEqual(first);
				expect(yield* store.getCachedPublicMetadata("stream-1")).toEqual(next);
			}),
		);
		expect(read).toHaveBeenCalledTimes(2);
	});
});
