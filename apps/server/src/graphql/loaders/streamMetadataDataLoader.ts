import { createDataLoaderFactory, type EffectRunner } from "@/effect/DataLoaderFactory";
import { StreamProjectionStore } from "@/effect/services/StreamProjectionStore";
import { Effect } from "effect";

const loadLegacyMetadata = Effect.fn("GraphQL.liveStreamStatus.legacyMetadata")(function* (
	streamId: string,
) {
	const store = yield* StreamProjectionStore;
	return yield* store
		.getCachedPublicMetadata(streamId)
		.pipe(
			Effect.catchTag("StreamProjectionReadError", (error) =>
				Effect.logWarning("Failed to load live stream metadata").pipe(
					Effect.annotateLogs({ streamId, cause: String(error.cause) }),
					Effect.as(null),
				),
			),
		);
});

/** Share the legacy fallback between both fields, including failures, within one request. */
export function createStreamMetadataDataLoader(runPromise: EffectRunner) {
	return createDataLoaderFactory(runPromise).make({
		name: "StreamMetadataDataLoader",
		batchLoad: (keys: readonly string[]) =>
			Effect.forEach(keys, loadLegacyMetadata, { concurrency: 4 }),
	});
}
