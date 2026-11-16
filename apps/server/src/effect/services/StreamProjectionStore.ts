import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import { getCampusLiveStatus } from "@/effect/services/stream/campusLiveStatus";
import {
	detailsFingerprint,
	hasDestinationOn,
	planStreamEvent,
	type CampusStreamNotification,
} from "@/effect/services/stream/notification";
import { LiveStreamConfigSchema, streamSlugMapping } from "@/effect/services/StreamMappingService";
import {
	decodePlatformMetadataByPlatformId,
	type PlatformMetadata,
} from "@/utils/castr/platformMetadata";
import { omitUndefined } from "@/utils/omitUndefined";
import { Cache, Context, DateTime, Effect, Exit, Layer, Option, Schema } from "effect";
import { Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";

import type { FirebaseCastrStream } from "@/utils/castr/index";

/**
 * Focused Firestore adapter for the stream projection documents (Phase A
 * step 2 of docs/streaming-migration-implementation-v3.md, per ADR 0003).
 *
 * Owns the raw Firestore reads/writes the streaming resolvers previously did
 * inline: the `castr-streams/{id}` document and the `app-config/live-stream`
 * aggregate. Metadata saves publish to both documents atomically. Only legacy
 * public metadata reads are cached; coordinator and authorization reads stay fresh.
 */

class StreamProjectionReadError extends Schema.TaggedError<StreamProjectionReadError>()(
	"StreamProjectionReadError",
	{
		streamId: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Failed to read stream projection ${this.streamId}`;
	}
}

class StreamProjectionWriteError extends Schema.TaggedError<StreamProjectionWriteError>()(
	"StreamProjectionWriteError",
	{
		streamId: Schema.String,
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Stream projection write failed for ${this.streamId}: ${this.detail}`;
	}
}

class LiveStreamConfigReadError extends Schema.TaggedError<LiveStreamConfigReadError>()(
	"LiveStreamConfigReadError",
	{
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return "Failed to read live-stream config";
	}
}

const decodeMetadataString = Schema.decodeUnknownOption(Schema.String);
const decodeNotificationRevision = Schema.decodeUnknownOption(Schema.Number);
const decodeTimestamp = Schema.decodeUnknownOption(Schema.instanceOf(Timestamp));
const toDate = (timestamp: Option.Option<Timestamp>) => Option.getOrUndefined(timestamp)?.toDate();
const decodeStoredDestination = Schema.decodeUnknownOption(
	Schema.Struct({ id: Schema.String, enabled: Schema.Boolean }),
);
const decodeMetadataMap = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const decodePublishedMetadata = Schema.decodeUnknownOption(
	Schema.Struct({ title: Schema.String, description: Schema.String }),
);
const STREAM_METADATA_CACHE_TTL = "5 minutes";

interface StreamMetadata {
	readonly title: string | undefined;
	readonly description: string | undefined;
}

interface LiveStreamConfigEntry extends DocumentData {
	id: string;
	slug?: string;
	isLive: boolean;
}

interface StreamMetadataUpdate {
	readonly streamId: string;
	readonly title: string;
	readonly description: string;
	/**
	 * Per-destination overrides to set, or null to clear. Applied on top of the
	 * overrides stored at write time, so concurrent saves that touch other
	 * destinations are preserved.
	 */
	readonly platformMetadataChanges: ReadonlyMap<string, PlatformMetadata | null>;
	readonly lastUpdated: Date;
	/** Set only when this campus's stream notifications are enabled. */
	readonly notificationCampusSlug?: string | undefined;
	/**
	 * Destinations Castr accepted switching on or off in this save. Applied to the
	 * switches stored at write time, so a destination another save turned on still
	 * counts when deciding whether the stream is live.
	 */
	readonly platformEnabledChanges: ReadonlyMap<string, boolean>;
}

interface StreamMetadataSaveResult {
	/** The event's notification, when this save claimed it. */
	readonly notification: CampusStreamNotification | undefined;
	/** Whether any destination is switched on after the save. */
	readonly streamIsLive: boolean;
}

interface LiveStatusUpdate {
	readonly streamId: string;
	readonly isLive: boolean;
}

type LiveStreamEntry = NonNullable<(typeof LiveStreamConfigSchema.Type)["streams"]>[number] & {
	readonly metadata?: StreamMetadata;
};

interface StreamProjectionStoreContract {
	/** Load the projected stream document, or undefined when it does not exist. */
	getStream: (
		streamId: string,
	) => Effect.Effect<FirebaseCastrStream | undefined, StreamProjectionReadError>;
	/** Cached fallback for projections saved before aggregate metadata was introduced. */
	getCachedPublicMetadata: (
		streamId: string,
	) => Effect.Effect<StreamMetadata, StreamProjectionReadError>;
	/**
	 * Load every stream entry in the aggregate `app-config/live-stream`
	 * document. A missing document or `streams` field means no streams.
	 */
	getLiveStreams: () => Effect.Effect<readonly LiveStreamEntry[], LiveStreamConfigReadError>;
	/**
	 * Atomically persist metadata and the stream's live event, claiming the
	 * event's one notification (see `planStreamEvent`), via a transaction.
	 * `.update()` rejects on a missing document. That is deliberate: a merge
	 * write here would materialize a partial projection document (metadata
	 * fields only) that clients listen to raw. A missing document is a
	 * corrupt-state signal worth failing loudly on.
	 */
	updateStreamMetadata: (
		input: StreamMetadataUpdate,
	) => Effect.Effect<StreamMetadataSaveResult, StreamProjectionWriteError>;
	/**
	 * Transactionally upsert one stream's entry in the aggregate
	 * `app-config/live-stream` document, preserving all other entries.
	 */
	setLiveStatus: (input: LiveStatusUpdate) => Effect.Effect<void, StreamProjectionWriteError>;
}

export class StreamProjectionStore extends Context.Service<
	StreamProjectionStore,
	StreamProjectionStoreContract
>()("StreamProjectionStore", {
	make: Effect.gen(function* () {
		const firebase = yield* FirebaseAdminContext;

		const streamDocRef = (streamId: string) =>
			firebase.db.collection(firebase.AppCollections.castrStreams).doc(streamId);
		const liveStreamDocRef = () =>
			firebase.db
				.collection(firebase.AppCollections.config)
				.doc(firebase.AppCollections.liveStreamDoc);

		const getStream = Effect.fn("StreamProjectionStore.getStream")(function* (streamId: string) {
			const snapshot = yield* Effect.tryPromise({
				try: () => streamDocRef(streamId).get() as Promise<DocumentSnapshot<FirebaseCastrStream>>,
				catch: (cause) => new StreamProjectionReadError({ streamId, cause }),
			});
			return snapshot.data();
		});

		// Legacy fallback only: new saves publish metadata in the fresh aggregate.
		// Shared lookups inherit the first caller's trace; joining callers wait on it.
		const metadataCache = yield* Cache.makeWith(
			Effect.fn("StreamProjectionStore.loadStreamMetadata")(function* (streamId: string) {
				const stream = yield* getStream(streamId);
				return {
					title: Option.getOrUndefined(decodeMetadataString(stream?.title)),
					description: Option.getOrUndefined(decodeMetadataString(stream?.description)),
				};
			}),
			{
				// Leave room for new streams while bounding legacy cache memory.
				capacity: 100,
				timeToLive: (exit) => (Exit.isSuccess(exit) ? STREAM_METADATA_CACHE_TTL : 0),
			},
		);
		const getCachedPublicMetadata = Effect.fn("StreamProjectionStore.getCachedPublicMetadata")(
			(streamId: string) => Cache.get(metadataCache, streamId),
		);

		const getLiveStreams = Effect.fn("StreamProjectionStore.getLiveStreams")(function* () {
			const snapshot = yield* Effect.tryPromise({
				try: () => liveStreamDocRef().get(),
				catch: (cause) => new LiveStreamConfigReadError({ cause }),
			});
			const data = snapshot.data();
			const config = yield* Schema.decodeUnknownEffect(LiveStreamConfigSchema)(data ?? {}).pipe(
				Effect.mapError((cause) => new LiveStreamConfigReadError({ cause })),
			);
			const metadataByStreamId = Option.getOrUndefined(decodeMetadataMap(data?.metadataByStreamId));
			const streams: LiveStreamEntry[] = [];
			for (const stream of config.streams ?? []) {
				const metadata = Option.getOrUndefined(
					decodePublishedMetadata(metadataByStreamId?.[stream.id]),
				);
				streams.push(metadata ? { ...stream, metadata } : stream);
			}
			return streams;
		});

		const updateStreamMetadata = Effect.fn("StreamProjectionStore.updateStreamMetadata")(
			function* ({
				streamId,
				title,
				description,
				platformMetadataChanges,
				lastUpdated,
				notificationCampusSlug,
				platformEnabledChanges,
			}: StreamMetadataUpdate) {
				return yield* Effect.tryPromise({
					try: () =>
						firebase.db.runTransaction(async (tx) => {
							const ref = streamDocRef(streamId);
							const snapshot = await tx.get(ref);
							if (!snapshot.exists) {
								throw new Error("Stream projection is missing");
							}
							const previous = snapshot.data();
							const platformMetadata = decodePlatformMetadataByPlatformId({
								platformMetadata: previous?.platformMetadata,
							});
							for (const [platformId, change] of platformMetadataChanges) {
								if (change) {
									platformMetadata[platformId] = change;
								} else {
									delete platformMetadata[platformId];
								}
							}
							// Decode each field independently so one malformed value cannot
							// reset the event and turn an edit into another notification.
							const previousRevision = Option.getOrElse(
								decodeNotificationRevision(previous?.notificationRevision),
								() => 0,
							);
							const notifiedAt = toDate(decodeTimestamp(previous?.notificationClaimedAt));
							// A claim made before fingerprints is compared with the details
							// saved since it; the baseline is persisted on this first save so
							// details saved offline later still count as a change.
							const notifiedFingerprint = Option.getOrElse(
								decodeMetadataString(previous?.notificationFingerprint),
								() =>
									notifiedAt === undefined
										? undefined
										: detailsFingerprint(
												Option.getOrElse(decodeMetadataString(previous?.title), () => ""),
												Option.getOrElse(decodeMetadataString(previous?.description), () => ""),
											),
							);
							// Each destination decodes on its own, so one malformed entry
							// cannot read as switched off and end the event.
							const storedDestinations = Array.isArray(previous?.platforms)
								? previous.platforms.flatMap((platform) =>
										Option.toArray(decodeStoredDestination(platform)),
									)
								: [];
							const streamIsLive = hasDestinationOn(storedDestinations, platformEnabledChanges);
							const { state, notification } = planStreamEvent({
								previous: {
									eventStartedAt: toDate(decodeTimestamp(previous?.liveEventStartedAt)),
									eventEndedAt: toDate(decodeTimestamp(previous?.liveEventEndedAt)),
									notifiedAt,
									notifiedFingerprint,
									revision:
										Number.isSafeInteger(previousRevision) && previousRevision >= 0
											? previousRevision
											: 0,
								},
								live: streamIsLive,
								now: lastUpdated,
								campusSlug: notificationCampusSlug,
								streamId,
								title,
								description,
							});
							tx.update(
								ref,
								omitUndefined({
									title,
									description,
									platformMetadata,
									last_updated: lastUpdated,
									liveEventStartedAt: state.eventStartedAt,
									// oxlint-disable-next-line no-null -- Firestore clears the end with null
									liveEventEndedAt: state.eventEndedAt ?? null,
									notificationRevision: notification?.revision,
									notificationClaimedAt: notification ? state.notifiedAt : undefined,
									notificationFingerprint: state.notifiedFingerprint,
								}),
							);
							// Merge a separate map so status polling can replace the streams
							// array without erasing metadata or another stream's latest save.
							tx.set(
								liveStreamDocRef(),
								{ metadataByStreamId: { [streamId]: { title, description } } },
								{ merge: true },
							);
							return { notification, streamIsLive };
						}),
					catch: (cause) =>
						new StreamProjectionWriteError({
							streamId,
							detail: "Failed to update stream metadata",
							cause,
						}),
				}).pipe(Effect.ensuring(Cache.invalidate(metadataCache, streamId)));
			},
		);

		const setLiveStatus = Effect.fn("StreamProjectionStore.setLiveStatus")(function* ({
			streamId,
			isLive,
		}: LiveStatusUpdate) {
			const liveStreamRef = liveStreamDocRef();
			const liveStreamStateRef = firebase.db
				.collection(firebase.AppCollections.config)
				.doc(firebase.AppCollections.liveStreamStateDoc);
			const observedAt = Timestamp.fromMillis(DateTime.toEpochMillis(yield* DateTime.now));

			yield* Effect.tryPromise({
				try: () =>
					firebase.db.runTransaction(async (tx) => {
						const snapshot = await tx.get(liveStreamRef);
						const data = snapshot.data() as { streams?: LiveStreamConfigEntry[] } | undefined;
						const currentStreams = Array.isArray(data?.streams) ? data.streams : [];
						const streamIndex = currentStreams.findIndex((stream) => stream.id === streamId);
						const streams = [...currentStreams];

						const existingStream = streams[streamIndex];
						const updatedStream = omitUndefined({
							...existingStream,
							id: streamId,
							slug:
								existingStream?.slug ??
								streamSlugMapping[streamId as keyof typeof streamSlugMapping]?.slug,
							isLive,
						});
						if (streamIndex === -1) {
							streams.push(updatedStream);
						} else {
							streams[streamIndex] = updatedStream;
						}

						tx.set(
							liveStreamRef,
							{ streams, campusLiveStatus: getCampusLiveStatus(streams) },
							{ merge: true },
						);
						// Advance this stream's stale-write guard marker so an in-flight
						// poll whose Castr snapshot predates this manual edit is
						// classified stale and cannot overwrite it. Nested-map merge
						// touches only this stream's key.
						tx.set(
							liveStreamStateRef,
							{ snapshotObservedAtByStreamId: { [streamId]: observedAt } },
							{ merge: true },
						);
					}),
				catch: (cause) =>
					new StreamProjectionWriteError({
						streamId,
						detail: "Failed to update live-stream config status",
						cause,
					}),
			});
		});

		return {
			getStream,
			getCachedPublicMetadata,
			getLiveStreams,
			updateStreamMetadata,
			setLiveStatus,
		};
	}),
}) {}

export const StreamProjectionStoreLive = Layer.effect(
	StreamProjectionStore,
	StreamProjectionStore.make,
);
