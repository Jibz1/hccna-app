import { AppConfig } from "@/effect/AppConfig";
import { RedisClient } from "bun";
import { Context, Effect, Layer, Schema } from "effect";

class RedisError extends Schema.TaggedError<RedisError>()("RedisError", {
	operation: Schema.String,
	key: Schema.optional(Schema.String),
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `Redis ${this.operation} failed${this.key ? ` for key '${this.key}'` : ""}`;
	}
}

const toRedisError = (operation: string, key?: string) => (cause: unknown) =>
	new RedisError({ operation, key, cause });

export interface RedisServiceContract {
	readonly get: (key: string) => Effect.Effect<string | null, RedisError>;
	readonly mget: (keys: string[]) => Effect.Effect<(string | null)[], RedisError>;
	readonly set: (key: string, value: string) => Effect.Effect<void, RedisError>;
	readonly setex: (key: string, seconds: number, value: string) => Effect.Effect<void, RedisError>;
	readonly incr: (key: string) => Effect.Effect<number, RedisError>;
	readonly decr: (key: string) => Effect.Effect<number, RedisError>;
	readonly ttl: (key: string) => Effect.Effect<number, RedisError>;
	readonly expire: (key: string, seconds: number) => Effect.Effect<void, RedisError>;
	readonly del: (key: string) => Effect.Effect<void, RedisError>;
	readonly keys: (pattern: string) => Effect.Effect<string[], RedisError>;
	readonly ping: () => Effect.Effect<unknown, RedisError>;
}

/**
 * RedisService - Effect service tag for shared Redis access.
 */
export class RedisService extends Context.Service<RedisService, RedisServiceContract>()(
	"RedisService",
	{
		make: Effect.gen(function* () {
			const appConfig = yield* AppConfig;
			const redis = yield* Effect.acquireRelease(
				Effect.sync(() => new RedisClient(appConfig.redis.connectionUrl)),
				(client) => Effect.sync(() => client.close()),
			);

			return {
				get: (key: string) =>
					Effect.tryPromise({
						try: () => redis.get(key),
						catch: toRedisError("get", key),
					}),
				mget: (keys: string[]) =>
					Effect.tryPromise({
						try: () => redis.mget(...keys),
						catch: toRedisError("mget"),
					}),
				set: (key: string, value: string) =>
					Effect.tryPromise({
						try: () => redis.set(key, value),
						catch: toRedisError("set", key),
					}).pipe(Effect.asVoid),
				setex: (key: string, seconds: number, value: string) =>
					Effect.tryPromise({
						try: () => redis.setex(key, seconds, value),
						catch: toRedisError("setex", key),
					}).pipe(Effect.asVoid),
				incr: (key: string) =>
					Effect.tryPromise({
						try: () => redis.incr(key),
						catch: toRedisError("incr", key),
					}),
				decr: (key: string) =>
					Effect.tryPromise({
						try: () => redis.decr(key),
						catch: toRedisError("decr", key),
					}),
				ttl: (key: string) =>
					Effect.tryPromise({
						try: () => redis.ttl(key),
						catch: toRedisError("ttl", key),
					}),
				expire: (key: string, seconds: number) =>
					Effect.tryPromise({
						try: () => redis.expire(key, seconds),
						catch: toRedisError("expire", key),
					}).pipe(Effect.asVoid),
				del: (key: string) =>
					Effect.tryPromise({
						try: () => redis.del(key),
						catch: toRedisError("del", key),
					}).pipe(Effect.asVoid),
				keys: (pattern: string) =>
					Effect.tryPromise({
						try: () => redis.keys(pattern),
						catch: toRedisError("keys", pattern),
					}),
				ping: () =>
					Effect.tryPromise({
						try: () => redis.send("PING", []),
						catch: toRedisError("ping"),
					}),
			} satisfies RedisServiceContract;
		}),
	},
) {}

export const RedisServiceLive = Layer.effect(RedisService, RedisService.make);
