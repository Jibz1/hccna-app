import DataLoader from "dataloader";
import { Effect, Schema } from "effect";

export class DataLoaderError extends Schema.TaggedError<DataLoaderError>()("DataLoaderError", {
	loader: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Load a key through a DataLoader as an Effect with a tagged error channel.
 * Preserves the underlying rejection message so resolver-facing errors stay
 * unchanged while gaining catchTag discrimination.
 */
export function loadViaDataLoader<K, V, C>(
	loader: DataLoader<K, V, C>,
	key: K,
	loaderName: string,
): Effect.Effect<V, DataLoaderError> {
	return Effect.tryPromise({
		try: () => loader.load(key),
		catch: (cause) =>
			new DataLoaderError({
				loader: loaderName,
				message: cause instanceof Error ? cause.message : `DataLoader '${loaderName}' load failed`,
				cause,
			}),
	});
}

export type EffectRunner<RProvided = unknown> = <A, E, R extends RProvided>(
	program: Effect.Effect<A, E, R>,
) => Promise<A>;

export interface DataLoaderFactory<RProvided = unknown> {
	make: <K, V, E, R extends RProvided, C = K>(input: {
		name: string;
		batchLoad: (keys: readonly K[]) => Effect.Effect<readonly V[], E, R>;
		options?: Omit<DataLoader.Options<K, V, C>, "name">;
	}) => DataLoader<K, V, C>;
}

/**
 * Wrap DataLoader batch functions around the shared Effect runtime bridge.
 */
export function createDataLoaderFactory<RProvided = unknown>(
	runPromise: EffectRunner<RProvided>,
): DataLoaderFactory<RProvided> {
	return {
		make: <K, V, E, R extends RProvided, C = K>({
			name,
			batchLoad,
			options,
		}: {
			name: string;
			batchLoad: (keys: readonly K[]) => Effect.Effect<readonly V[], E, R>;
			options?: Omit<DataLoader.Options<K, V, C>, "name">;
		}) =>
			// DataLoader expects a Promise-returning batch function, so adapt the
			// Effect program once here instead of at each loader definition.
			new DataLoader<K, V, C>((keys) => runPromise(batchLoad(keys)), {
				...options,
				name,
			}),
	};
}
