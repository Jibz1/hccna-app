import { AppConfig } from "@/effect/AppConfig";
import { Context, Effect, Layer, Schema } from "effect";
import { LRUCache } from "lru-cache";

class LRUError extends Schema.TaggedError<LRUError>()("LRUError", {
	operation: Schema.String,
	key: Schema.optional(Schema.String),
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `LRU ${this.operation} failed${this.key ? ` for key '${this.key}'` : ""}`;
	}
}

interface LRUConfig {
	readonly max?: number;
	readonly ttl?: number;
	readonly ttlAutopurge?: boolean;
}

type CacheValue = NonNullable<unknown>;

export interface LRUServiceContract {
	readonly get: <T>(key: string) => Effect.Effect<T | undefined, LRUError>;
	readonly set: <T>(key: string, value: T, ttl?: number) => Effect.Effect<void, LRUError>;
	readonly delete: (key: string) => Effect.Effect<boolean, LRUError>;
}

interface LRUCacheOptions {
	max: number;
	ttl?: number;
	ttlAutopurge?: boolean;
}

const toLRUError = (operation: string, key?: string) => (cause: unknown) =>
	new LRUError({ operation, key, cause });

function makeLruService(config: LRUConfig): LRUServiceContract {
	const cacheOptions: LRUCacheOptions = {
		max: config.max ?? 1000,
	};

	// Keep the in-process cache generic; callers own key and value semantics.
	if (config.ttl !== undefined) {
		cacheOptions.ttl = config.ttl;
		cacheOptions.ttlAutopurge = config.ttlAutopurge ?? true;
	}

	const cache = new LRUCache<string, CacheValue>(cacheOptions);

	return {
		get: <T>(key: string) =>
			Effect.try({
				try: () => cache.get(key) as T | undefined,
				catch: toLRUError("get", key),
			}),
		set: <T>(key: string, value: T, ttl?: number) =>
			Effect.try({
				try: () => {
					cache.set(key, value as CacheValue, ttl ? { ttl } : undefined);
				},
				catch: toLRUError("set", key),
			}),
		delete: (key: string) =>
			Effect.try({
				try: () => cache.delete(key),
				catch: toLRUError("delete", key),
			}),
	} satisfies LRUServiceContract;
}

/**
 * LRUService - Effect service tag for process-local caching.
 */
export class LRUService extends Context.Service<LRUService, LRUServiceContract>()("LRUService", {
	make: Effect.gen(function* () {
		const appConfig = yield* AppConfig;
		// Source cache sizing from the shared app config.
		return makeLruService({
			max: appConfig.lru.max,
			ttl: appConfig.lru.ttlMs,
		});
	}),
}) {}

export const LRUServiceLive = Layer.effect(LRUService, LRUService.make);
