import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import { getCampusLiveStatus } from "@/effect/services/stream/campusLiveStatus";
import { omitUndefined } from "@/utils/omitUndefined";
import { Context, DateTime, Effect, Layer, Predicate, Result, Schema } from "effect";
import { Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore";

import { CastrService } from "./CastrService";

import type { Doc, LiveStreams } from "@/utils/castr/index";
// oxlint-disable max-classes-per-file
import type { CastrError } from "@hccnj/castr";

const HOUSE_OF_STARS_STREAM_ID = "66fee62923691fe5aeb55a12";

export const streamSlugMapping = {
	[HOUSE_OF_STARS_STREAM_ID]: {
		slug: "house-of-stars",
		type: "church",
		playerUrl: "https://player.castr.com/live_9656bd8081b711ef8d375d3cc4dea12c",
	},
	"66feeb8d3b9ad6e54467233f": {
		slug: "house-of-stars-junior-church",
		type: "church-1",
		playerUrl: "https://player.castr.com/live_ccf5dda081ba11efa203a98c47c1039f",
	},
	"66feec593b9ad6e544672c92": {
		slug: "new-breed",
		type: "church",
		playerUrl: "https://player.castr.com/live_464ca3f081bb11efa203a98c47c1039f",
	},
	"66feeea7254f38e5989f57ac": {
		slug: "light-house",
		type: "church",
		playerUrl: "https://player.castr.com/live_a6889b6081bc11ef98ccdfc25f2b4b00",
	},
	"66fef0c0238bdce58dbd34aa": {
		slug: "impact-house",
		type: "church",
		playerUrl: "https://player.castr.com/live_e60dc98081bd11efb03181f8f706dd4a",
	},
	"66fef4c89fce19e5c5c48886": {
		slug: "jubilee-place",
		type: "church",
		playerUrl: "https://player.castr.com/live_4dad6d5081c011efa8c8b9b7b459a5bd",
	},
	"6792e5f600f02cca2eb505e6": {
		slug: "joseph-siju",
		type: "stream",
		playerUrl: "https://player.castr.com/live_79db8c50d9ee11efb5ebf7655896c5a7",
	},
} as const;

class StreamMappingError extends Schema.TaggedError<StreamMappingError>()("StreamMappingError", {
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `Stream mapping: ${this.detail}`;
	}
}

interface UpdateStreamMappingOptions {
	isEndingStream?: boolean;
	streamId?: string;
	trigger?: "cron" | "manual-mutation";
}

const FirestoreTimestampSchema = Schema.instanceOf(Timestamp, {
	expected: "Firestore Timestamp",
});

const LiveStreamEntrySchema = Schema.Struct({
	id: Schema.String,
	// Carried through the stale-write guard so a skipped stream's aggregate entry
	// survives carry-forward intact (the streams array is replaced wholesale).
	slug: Schema.optional(Schema.String),
	isLive: Schema.Boolean,
});

export const LiveStreamConfigSchema = Schema.Struct({
	streams: Schema.optional(Schema.Array(LiveStreamEntrySchema)),
});
type LiveStreamConfig = typeof LiveStreamConfigSchema.Type;

const LiveStreamStateConfigSchema = Schema.Struct({
	offlineObservedAtByStreamId: Schema.Record(Schema.String, FirestoreTimestampSchema),
	lastCheckedAtByStreamId: Schema.optional(Schema.Record(Schema.String, FirestoreTimestampSchema)),
	// Stale-write guard marker: when each stream's projection last observed a
	// fresh Castr snapshot. See docs/streaming-migration-implementation-v3.md.
	snapshotObservedAtByStreamId: Schema.optional(
		Schema.Record(Schema.String, FirestoreTimestampSchema),
	),
});
type LiveStreamStateConfig = Omit<
	typeof LiveStreamStateConfigSchema.Type,
	"lastCheckedAtByStreamId" | "snapshotObservedAtByStreamId"
> & {
	lastCheckedAtByStreamId: Record<string, Timestamp>;
	snapshotObservedAtByStreamId: Record<string, Timestamp>;
};

type StreamCountdownEvent =
	| "offline-observed"
	| "offline-cleared"
	| "offline-expired"
	| "castr-disabled"
	| "manual-ended";

interface StreamLiveResolution {
	isLive: boolean;
	event?: StreamCountdownEvent | undefined;
	nextOfflineObservedAt?: Timestamp | undefined;
}

interface StreamResolutionResult {
	streamData: {
		id: string;
		slug?: string;
		isLive: boolean;
	};
	streamToDisableInCastr?: Doc | undefined;
}

type CastrDisableResult =
	| {
			platformId: string;
			status: "patched";
	  }
	| {
			platformId: string;
			status: "skipped" | "failed";
			error: string;
	  };

interface ParsedConfigResult<T> {
	value: T;
	error?: string | undefined;
}

const OFFLINE_GRACE_PERIOD_MS = 10 * 60 * 1000;
// CastrPoll runs every 10 minutes, but its runs drift by tens of seconds, so the
// next run can land just short of the grace period (9m42s on 2026-11-07) and
// leave the stream live for a third poll. The allowance lets the second offline
// reading end it; one reading alone still cannot, because the timer starts at it.
const POLL_JITTER_ALLOWANCE_MS = 60 * 1000;
// Bound Castr reconciliation work so a large batch of expired streams does not
// create an unbounded number of concurrent patch requests during shutdown or
// cancellation.
const ENDED_STREAM_DISABLE_CONCURRENCY = 4;

// Castr can report a stream as enabled before it is truly offline, so treat any
// active platform state as live unless the caller is explicitly ending the stream.
const isChannelLive = (data: Doc) =>
	data.platforms.some((platform) => platform.broadcasting_status !== "offline" || platform.enabled);

// Castr has the stream, or every destination, switched off. Unlike a dropped
// encoder, nothing reconnects on its own, so this needs no grace period.
const isSwitchedOffInCastr = (data: Doc) =>
	!data.enabled || !data.platforms.some((platform) => platform.enabled);

const getPreviousIsLive = (
	streamId: string,
	liveStreamConfig: LiveStreamConfig | undefined,
	fallback: boolean,
) => liveStreamConfig?.streams?.find((stream) => stream.id === streamId)?.isLive ?? fallback;

const isNonFatalCastrPatchError = (message: string) =>
	/Castr API error: (?<statusCode>404|409)\b/u.test(message);

const parseLiveStreamConfig = (
	data: DocumentData | undefined,
): ParsedConfigResult<LiveStreamConfig | undefined> => {
	if (data === undefined) {
		return { value: undefined };
	}

	const parsed = Schema.decodeUnknownResult(LiveStreamConfigSchema)(data);
	if (Result.isSuccess(parsed)) {
		return { value: parsed.success };
	}

	return {
		value: undefined,
		error: String(parsed.failure),
	};
};

const parseLiveStreamStateConfig = (
	data: DocumentData | undefined,
): ParsedConfigResult<LiveStreamStateConfig> => {
	if (data === undefined) {
		return {
			value: {
				offlineObservedAtByStreamId: {},
				lastCheckedAtByStreamId: {},
				snapshotObservedAtByStreamId: {},
			},
		};
	}

	const parsed = Schema.decodeUnknownResult(LiveStreamStateConfigSchema)(data);
	if (Result.isSuccess(parsed)) {
		return {
			value: {
				...parsed.success,
				lastCheckedAtByStreamId: parsed.success.lastCheckedAtByStreamId ?? {},
				snapshotObservedAtByStreamId: parsed.success.snapshotObservedAtByStreamId ?? {},
			},
		};
	}

	return {
		value: {
			offlineObservedAtByStreamId: {},
			lastCheckedAtByStreamId: {},
			snapshotObservedAtByStreamId: {},
		},
		error: String(parsed.failure),
	};
};

export const resolveStreamLiveState = ({
	stream,
	previousIsLive,
	offlineObservedAt,
	isEndingStream,
	now,
}: {
	stream: Doc;
	previousIsLive: boolean;
	offlineObservedAt?: Timestamp | undefined;
	isEndingStream: boolean;
	now: number;
}): StreamLiveResolution => {
	if (isEndingStream) {
		return {
			isLive: false,
			event: "manual-ended",
			nextOfflineObservedAt: undefined,
		};
	}

	if (
		stream.broadcasting_status === "online" ||
		stream.platforms.some((platform) => platform.broadcasting_status === "online")
	) {
		return omitUndefined({
			isLive: isChannelLive(stream),
			event: offlineObservedAt ? ("offline-cleared" as const) : undefined,
			nextOfflineObservedAt: undefined,
		});
	}

	if (!previousIsLive) {
		return omitUndefined({
			isLive: false,
			event: offlineObservedAt ? ("offline-cleared" as const) : undefined,
			nextOfflineObservedAt: undefined,
		});
	}

	if (isSwitchedOffInCastr(stream)) {
		return {
			isLive: false,
			event: "castr-disabled",
			nextOfflineObservedAt: undefined,
		};
	}

	if (!offlineObservedAt) {
		return {
			isLive: true,
			event: "offline-observed",
			// A previous check is not evidence that the stream was offline then.
			nextOfflineObservedAt: Timestamp.fromMillis(now),
		};
	}

	if (now - offlineObservedAt.toMillis() < OFFLINE_GRACE_PERIOD_MS - POLL_JITTER_ALLOWANCE_MS) {
		return {
			isLive: true,
			nextOfflineObservedAt: offlineObservedAt,
		};
	}

	return {
		isLive: false,
		event: "offline-expired",
		nextOfflineObservedAt: undefined,
	};
};

/**
 * StreamMappingService - Mirrors Castr stream state into Firebase. Polls never send notifications.
 */
interface StreamMappingServiceContract {
	updateStreamMapping: (
		options?: UpdateStreamMappingOptions,
	) => Effect.Effect<void, CastrError | StreamMappingError>;
}

export class StreamMappingService extends Context.Service<
	StreamMappingService,
	StreamMappingServiceContract
>()("StreamMappingService", {
	make: Effect.gen(function* () {
		const firebase = yield* FirebaseAdminContext;
		const castrService = yield* CastrService;

		const writeToFirebase = Effect.fn("StreamMappingService.writeToFirebase")(function* (
			docs: LiveStreams["docs"],
			options: UpdateStreamMappingOptions,
			// When this run's Castr snapshot was observed (captured before the cache
			// invalidation + fetch). The stale-write guard compares it against the
			// per-stream markers persisted in live-stream-state.
			snapshotObservedAt: number,
		) {
			const trigger = options.trigger ?? "cron";
			const liveStreamRef = firebase.db
				.collection(firebase.AppCollections.config)
				.doc(firebase.AppCollections.liveStreamDoc);
			const liveStreamStateRef = firebase.db
				.collection(firebase.AppCollections.config)
				.doc(firebase.AppCollections.liveStreamStateDoc);
			const disableEndedStreamPlatforms = Effect.fn(
				"StreamMappingService.disableEndedStreamPlatforms",
			)(function* (stream: Doc) {
				const enabledPlatforms = stream.platforms.filter((platform) => platform.enabled);

				if (enabledPlatforms.length === 0) {
					return;
				}

				const results = yield* Effect.forEach(
					enabledPlatforms,
					(platform) =>
						castrService
							.patchPlatform({
								streamId: stream._id,
								platformId: platform._id,
								data: {
									enabled: false,
								},
							})
							.pipe(
								Effect.as({
									platformId: platform._id,
									status: "patched",
								} as const),
								Effect.catchTag("CastrPatchError", (error) =>
									Effect.succeed({
										platformId: platform._id,
										status: isNonFatalCastrPatchError(error.message) ? "skipped" : "failed",
										error: error.message,
									} satisfies CastrDisableResult),
								),
							),
					{ concurrency: ENDED_STREAM_DISABLE_CONCURRENCY },
				);
				const patchedPlatforms: string[] = [];
				const skippedPlatforms: string[] = [];
				const skippedErrors: string[] = [];
				const failedPlatforms: string[] = [];
				const failedErrors: string[] = [];

				for (const result of results) {
					if (result.status === "patched") {
						patchedPlatforms.push(result.platformId);
					} else if (result.status === "skipped") {
						skippedPlatforms.push(result.platformId);
						skippedErrors.push(result.error);
					} else {
						failedPlatforms.push(result.platformId);
						failedErrors.push(result.error);
					}
				}

				if (skippedPlatforms.length > 0) {
					yield* Effect.logWarning(
						"Castr platform disable skipped for already-reconciled platform",
					).pipe(
						Effect.annotateLogs({
							streamId: stream._id,
							patchedPlatforms,
							skippedPlatforms,
							errors: skippedErrors,
							operation: "disableEndedStreamPlatforms",
						}),
					);
				}

				if (failedPlatforms.length > 0) {
					yield* Effect.logError("Castr platform disable reconciliation incomplete").pipe(
						Effect.annotateLogs({
							streamId: stream._id,
							patchedPlatforms,
							failedPlatforms,
							errors: failedErrors,
							operation: "disableEndedStreamPlatforms",
						}),
					);
				}
			});
			const now = DateTime.toEpochMillis(yield* DateTime.now);
			const transactionResult = yield* Effect.tryPromise({
				try: () =>
					firebase.db.runTransaction(async (tx) => {
						const [liveStreamConfigSnapshot, liveStreamStateSnapshot] = await Promise.all([
							tx.get(liveStreamRef),
							tx.get(liveStreamStateRef),
						]);
						const liveStreamConfigResult = parseLiveStreamConfig(liveStreamConfigSnapshot.data());
						const liveStreamStateResult = parseLiveStreamStateConfig(
							liveStreamStateSnapshot.data(),
						);
						const checkedAt = Timestamp.fromMillis(now);
						const snapshotObservedAtTimestamp = Timestamp.fromMillis(snapshotObservedAt);
						const nextOfflineObservedAtByStreamId = {
							...liveStreamStateResult.value.offlineObservedAtByStreamId,
						};
						const nextLastCheckedAtByStreamId = {
							...liveStreamStateResult.value.lastCheckedAtByStreamId,
						};
						const nextSnapshotObservedAtByStreamId = {
							...liveStreamStateResult.value.snapshotObservedAtByStreamId,
						};
						const staleSkippedStreamIds: string[] = [];
						const streamWrites: {
							docRef: DocumentReference;
							data: DocumentData;
						}[] = [];
						const pollEndedEvents: {
							docRef: DocumentReference;
							endedAt: Timestamp;
						}[] = [];
						const transitionEvents: {
							streamId: string;
							event: StreamCountdownEvent;
							broadcastingStatus: Doc["broadcasting_status"];
							onlinePlatformCount: number;
							isLive: boolean;
						}[] = [];
						const parseWarnings = [
							liveStreamConfigResult.error
								? {
										documentId: firebase.AppCollections.liveStreamDoc,
										error: liveStreamConfigResult.error,
									}
								: undefined,
							liveStreamStateResult.error
								? {
										documentId: firebase.AppCollections.liveStreamStateDoc,
										error: liveStreamStateResult.error,
									}
								: undefined,
						].filter((warning) => Predicate.isNotUndefined(warning));

						const resolvedStreams: StreamResolutionResult[] = docs.flatMap((item) => {
							// Stale-write guard: another poll that observed a NEWER Castr
							// snapshot already projected this stream. Committing this run's
							// older observation would overwrite fresher state, so carry the
							// stream's previous aggregate entry forward unchanged and leave
							// its documents and grace markers untouched. When no previous
							// entry survives (e.g. the aggregate doc failed to parse), fall
							// through and project normally: an older-but-real observation
							// beats evicting the stream from the aggregate.
							const storedSnapshotObservedAt =
								liveStreamStateResult.value.snapshotObservedAtByStreamId[item._id];
							const previousEntry =
								storedSnapshotObservedAt !== undefined &&
								storedSnapshotObservedAt.toMillis() > snapshotObservedAt
									? liveStreamConfigResult.value?.streams?.find((stream) => stream.id === item._id)
									: undefined;
							if (previousEntry) {
								staleSkippedStreamIds.push(item._id);
								return [
									{
										streamData: omitUndefined({
											id: previousEntry.id,
											slug: previousEntry.slug,
											isLive: previousEntry.isLive,
										}),
									},
								];
							}

							const slug = streamSlugMapping[item._id as keyof typeof streamSlugMapping]?.slug;
							const docRef = firebase.db
								.collection(firebase.AppCollections.castrStreams)
								.doc(item._id);
							const offlineObservedAt =
								liveStreamStateResult.value.offlineObservedAtByStreamId[item._id];
							const resolution = resolveStreamLiveState({
								stream: item,
								previousIsLive: getPreviousIsLive(
									item._id,
									liveStreamConfigResult.value,
									isChannelLive(item),
								),
								offlineObservedAt,
								isEndingStream: options.streamId === item._id && options.isEndingStream === true,
								now,
							});
							const isEnded =
								resolution.event === "offline-expired" || resolution.event === "manual-ended";

							// The poll ended a stream nobody stopped in the app, so it also
							// ends the live event a save would have ended (see planStreamEvent).
							// It ended when Castr was first seen offline, if that was earlier.
							if (resolution.event === "offline-expired" || resolution.event === "castr-disabled") {
								pollEndedEvents.push({
									docRef,
									endedAt: offlineObservedAt ?? checkedAt,
								});
							}

							streamWrites.push({
								docRef,
								data: omitUndefined({
									name: item.name,
									slug: slug || undefined,
									enabled: isEnded ? false : item.enabled,
									id: item._id,
									broadcasting_status: item.broadcasting_status,
									platforms: item.platforms.map((platform) => ({
										id: platform._id,
										name: platform.name,
										enabled: isEnded ? false : platform.enabled,
										template: platform.template,
										server: platform.server,
										key: platform.key,
										broadcasting_status: platform.broadcasting_status,
									})),
								}),
							});

							if (resolution.nextOfflineObservedAt) {
								nextOfflineObservedAtByStreamId[item._id] = resolution.nextOfflineObservedAt;
							} else {
								delete nextOfflineObservedAtByStreamId[item._id];
							}
							nextLastCheckedAtByStreamId[item._id] = checkedAt;
							nextSnapshotObservedAtByStreamId[item._id] = snapshotObservedAtTimestamp;

							if (resolution.event) {
								transitionEvents.push({
									streamId: item._id,
									event: resolution.event,
									broadcastingStatus: item.broadcasting_status,
									onlinePlatformCount: item.platforms.filter(
										(platform) => platform.broadcasting_status === "online",
									).length,
									isLive: resolution.isLive,
								});
							}

							return [
								omitUndefined({
									streamData: omitUndefined({
										id: item._id,
										slug: slug || undefined,
										isLive: resolution.isLive,
									}),
									streamToDisableInCastr: resolution.event === "offline-expired" ? item : undefined,
								}),
							];
						});

						// Transactions read before they write. Keep the first end, as a
						// save does, so a later poll never extends the restart grace.
						const endedEventSnapshots =
							pollEndedEvents.length > 0
								? await tx.getAll(...pollEndedEvents.map(({ docRef }) => docRef))
								: [];
						const eventEndByPath = new Map(
							pollEndedEvents.flatMap(({ docRef, endedAt }, index) =>
								Predicate.isNullish(endedEventSnapshots[index]?.get("liveEventEndedAt"))
									? [[docRef.path, endedAt] as const]
									: [],
							),
						);
						for (const { docRef, data } of streamWrites) {
							const liveEventEndedAt = eventEndByPath.get(docRef.path);
							tx.set(docRef, liveEventEndedAt ? { ...data, liveEventEndedAt } : data, {
								merge: true,
							});
						}

						const streams = resolvedStreams.map((stream) => stream.streamData);
						tx.set(
							liveStreamRef,
							{
								streams,
								campusLiveStatus: getCampusLiveStatus(streams),
							},
							{ merge: true },
						);
						tx.set(
							liveStreamStateRef,
							{
								offlineObservedAtByStreamId: nextOfflineObservedAtByStreamId,
								lastCheckedAtByStreamId: nextLastCheckedAtByStreamId,
								snapshotObservedAtByStreamId: nextSnapshotObservedAtByStreamId,
							},
							// Replace the maps read in this transaction. A recursive merge
							// retains deleted timers whenever another stream is still offline.
							{
								mergeFields: [
									"offlineObservedAtByStreamId",
									"lastCheckedAtByStreamId",
									"snapshotObservedAtByStreamId",
								],
							},
						);

						return {
							parseWarnings,
							resolvedStreams,
							transitionEvents,
							staleSkippedStreamIds,
						};
					}),
				catch: (error) =>
					new StreamMappingError({
						detail: "Failed to update stream mapping transaction",
						cause: error,
					}),
			});

			yield* Effect.forEach(
				transactionResult.parseWarnings,
				(warning) =>
					Effect.logWarning(`Invalid ${warning.documentId} document`).pipe(
						Effect.annotateLogs({
							documentId: warning.documentId,
							operation: "writeToFirebase",
							trigger,
							error: warning.error,
						}),
					),
				{ discard: true },
			);

			if (transactionResult.staleSkippedStreamIds.length > 0) {
				yield* Effect.logWarning("Stale poll snapshot skipped for streams").pipe(
					Effect.annotateLogs({
						operation: "writeToFirebase",
						trigger,
						snapshotObservedAt,
						staleSkipped: transactionResult.staleSkippedStreamIds.length,
						streamIds: transactionResult.staleSkippedStreamIds.join(","),
					}),
				);
			}

			const streamsToDisableInCastr = transactionResult.resolvedStreams.flatMap(
				({ streamToDisableInCastr }) => (streamToDisableInCastr ? [streamToDisableInCastr] : []),
			);

			if (streamsToDisableInCastr.length > 0) {
				yield* Effect.log("Reconciling ended streams in Castr").pipe(
					Effect.annotateLogs({
						operation: "writeToFirebase",
						trigger,
						streamCount: streamsToDisableInCastr.length,
						concurrencyLimit: ENDED_STREAM_DISABLE_CONCURRENCY,
					}),
				);
			}

			yield* Effect.forEach(streamsToDisableInCastr, disableEndedStreamPlatforms, {
				concurrency: ENDED_STREAM_DISABLE_CONCURRENCY,
				discard: true,
			});

			yield* Effect.forEach(
				transactionResult.transitionEvents,
				(transition) =>
					Effect.log("Stream live status transition").pipe(
						Effect.annotateLogs({
							...transition,
							operation: "writeToFirebase",
							trigger,
						}),
					),
				{ discard: true },
			);
		});

		const updateStreamMappingImpl = Effect.fn("StreamMappingService.updateStreamMapping")(
			function* (options: UpdateStreamMappingOptions = {}) {
				const resolvedOptions = {
					trigger: "cron" as const,
					...options,
				};
				// Captured BEFORE the cache invalidation + fetch: a wall-clock proxy for
				// when this run's Castr snapshot was observed. Captured any later, an
				// overlapping poll could fetch fresher data yet carry an older marker.
				const snapshotObservedAt = DateTime.toEpochMillis(yield* DateTime.now);
				yield* castrService.invalidateLiveStreamsCache;
				const data = yield* castrService.getLiveStreams;

				if (!data.docs || data.docs.length === 0) {
					return yield* Effect.fail(new StreamMappingError({ detail: "No stream data found" }));
				}

				yield* writeToFirebase(data.docs, resolvedOptions, snapshotObservedAt);
			},
		);

		return {
			updateStreamMapping: updateStreamMappingImpl,
		};
	}),
}) {}

export const StreamMappingServiceLive = Layer.effect(
	StreamMappingService,
	StreamMappingService.make,
);
