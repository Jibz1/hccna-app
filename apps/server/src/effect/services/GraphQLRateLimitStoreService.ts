import { RedisService } from "@/effect/RedisService";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

interface ClientRateLimitInfo {
	totalHits: number;
	resetTime?: Date;
}

interface GraphQLRateLimitStore {
	readonly prefix?: string;
	readonly localKeys?: boolean;
	readonly get?: (key: string) => Promise<ClientRateLimitInfo | undefined>;
	readonly increment: (key: string) => Promise<ClientRateLimitInfo>;
	readonly decrement: (key: string) => Promise<void>;
	readonly resetKey: (key: string) => Promise<void>;
}

class GraphQLRateLimitStoreError extends Schema.TaggedError<GraphQLRateLimitStoreError>()(
	"GraphQLRateLimitStoreError",
	{
		operation: Schema.String,
		key: Schema.optional(Schema.String),
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `GraphQL rate limit store ${this.operation} failed${this.key ? ` for key '${this.key}'` : ""}`;
	}
}

interface GraphQLRateLimitStoreServiceContract {
	readonly createStore: (windowMs: number) => GraphQLRateLimitStore;
}

interface LocalRateLimitEntry {
	readonly totalHits: number;
	readonly expiresAt: number;
}

const GRAPHQL_RATE_LIMIT_PREFIX = "graphql:rate-limit";

const getRateLimitKey = (key: string) => `${GRAPHQL_RATE_LIMIT_PREFIX}:${key}`;
const toWindowSeconds = (windowMs: number) => Math.ceil(windowMs / 1000);

function noRateLimitInfo(): ClientRateLimitInfo | undefined {
	const values: ClientRateLimitInfo[] = [];
	return values[0];
}

class GraphQLRateLimitStoreService extends Context.Service<
	GraphQLRateLimitStoreService,
	GraphQLRateLimitStoreServiceContract
>()("GraphQLRateLimitStoreService", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const localFallbackHits = new Map<string, LocalRateLimitEntry>();

		const pruneExpiredFallbackEntries = (now: number) => {
			for (const [key, entry] of localFallbackHits.entries()) {
				if (entry.expiresAt <= now) {
					localFallbackHits.delete(key);
				}
			}
		};

		const incrementLocalFallback = (key: string, windowMs: number): ClientRateLimitInfo => {
			const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
			pruneExpiredFallbackEntries(now);

			const current = localFallbackHits.get(key);
			const expiresAt = current && current.expiresAt > now ? current.expiresAt : now + windowMs;
			const totalHits = current && current.expiresAt > now ? current.totalHits + 1 : 1;

			localFallbackHits.set(key, {
				totalHits,
				expiresAt,
			});

			return {
				totalHits,
				resetTime: new Date(expiresAt),
			} satisfies ClientRateLimitInfo;
		};

		// Heals keys that lost their TTL (e.g. a crash between INCR and EXPIRE
		// left a key that never expires, permanently rate-limiting a client).
		// Runs detached so the per-request path never blocks on the extra TTL
		// round-trip — at remote-Redis latencies that read used to dominate
		// every request's response time.
		const ensureWindowExpiry = Effect.fn("GraphQLRateLimitStoreService.ensureWindowExpiry")(
			function* (redisKey: string, windowMs: number) {
				const ttlSeconds = yield* redis.ttl(redisKey);
				if (ttlSeconds <= 0) {
					yield* redis.expire(redisKey, toWindowSeconds(windowMs));
				}
			},
		);

		const increment = Effect.fn("GraphQLRateLimitStoreService.increment")(function* (
			key: string,
			windowMs: number,
		) {
			const redisKey = getRateLimitKey(key);
			const totalHits = yield* redis.incr(redisKey).pipe(
				Effect.mapError(
					(cause) =>
						new GraphQLRateLimitStoreError({
							operation: "incr",
							key: redisKey,
							cause,
						}),
				),
			);

			yield* totalHits === 1
				? redis.expire(redisKey, toWindowSeconds(windowMs)).pipe(
						Effect.mapError(
							(cause) =>
								new GraphQLRateLimitStoreError({
									operation: "expire",
									key: redisKey,
									cause,
								}),
						),
					)
				: Effect.forkDetach(
						ensureWindowExpiry(redisKey, windowMs).pipe(Effect.catch(() => Effect.void)),
					);

			const now = DateTime.toEpochMillis(yield* DateTime.now);

			// `now + windowMs` is exact on the first hit of a window and an
			// upper bound (off by < windowMs, here 1s) afterwards — close
			// enough for the RateLimit-Reset header, and it avoids a blocking
			// TTL read on every request.
			return {
				totalHits,
				resetTime: new Date(now + windowMs),
			} satisfies ClientRateLimitInfo;
		});

		const get = Effect.fn("GraphQLRateLimitStoreService.get")(function* (
			key: string,
			windowMs: number,
		) {
			const redisKey = getRateLimitKey(key);
			const rawHits = yield* redis.get(redisKey).pipe(
				Effect.mapError(
					(cause) =>
						new GraphQLRateLimitStoreError({
							operation: "get",
							key: redisKey,
							cause,
						}),
				),
			);

			if (!rawHits) {
				return;
			}

			let ttlSeconds = yield* redis.ttl(redisKey).pipe(
				Effect.mapError(
					(cause) =>
						new GraphQLRateLimitStoreError({
							operation: "ttl",
							key: redisKey,
							cause,
						}),
				),
			);

			if (ttlSeconds <= 0) {
				yield* redis.expire(redisKey, toWindowSeconds(windowMs)).pipe(
					Effect.mapError(
						(cause) =>
							new GraphQLRateLimitStoreError({
								operation: "expire",
								key: redisKey,
								cause,
							}),
					),
				);

				ttlSeconds = yield* redis.ttl(redisKey).pipe(
					Effect.mapError(
						(cause) =>
							new GraphQLRateLimitStoreError({
								operation: "ttl",
								key: redisKey,
								cause,
							}),
					),
				);
			}

			const boundedTtlSeconds = ttlSeconds > 0 ? ttlSeconds : toWindowSeconds(windowMs);
			const now = DateTime.toEpochMillis(yield* DateTime.now);

			return {
				totalHits: Number(rawHits) || 0,
				resetTime: new Date(now + boundedTtlSeconds * 1000),
			} satisfies ClientRateLimitInfo;
		});

		const decrement = Effect.fn("GraphQLRateLimitStoreService.decrement")(function* (key: string) {
			const redisKey = getRateLimitKey(key);
			const nextHits = yield* redis.decr(redisKey).pipe(
				Effect.mapError(
					(cause) =>
						new GraphQLRateLimitStoreError({
							operation: "decr",
							key: redisKey,
							cause,
						}),
				),
			);

			if (nextHits <= 0) {
				yield* redis.del(redisKey).pipe(
					Effect.mapError(
						(cause) =>
							new GraphQLRateLimitStoreError({
								operation: "del",
								key: redisKey,
								cause,
							}),
					),
				);
			}
		});

		const resetKey = Effect.fn("GraphQLRateLimitStoreService.resetKey")(function* (key: string) {
			yield* redis.del(getRateLimitKey(key)).pipe(
				Effect.mapError(
					(cause) =>
						new GraphQLRateLimitStoreError({
							operation: "del",
							key,
							cause,
						}),
				),
			);
		});

		const createStore = (windowMs: number): GraphQLRateLimitStore => ({
			prefix: GRAPHQL_RATE_LIMIT_PREFIX,
			localKeys: false,
			get: (key: string) =>
				Effect.runPromise(
					get(key, windowMs).pipe(Effect.catch(() => Effect.sync(noRateLimitInfo))),
				),
			increment: (key: string) =>
				Effect.runPromise(
					increment(key, windowMs).pipe(
						Effect.catch((error) =>
							Effect.logWarning("GraphQL rate limit store fell back to local memory").pipe(
								Effect.annotateLogs({
									key,
									windowMs,
									error: error.message,
								}),
								Effect.as(incrementLocalFallback(key, windowMs)),
							),
						),
					),
				),
			decrement: (key: string) =>
				Effect.runPromise(decrement(key).pipe(Effect.catch(() => Effect.void))),
			resetKey: (key: string) =>
				Effect.runPromise(resetKey(key).pipe(Effect.catch(() => Effect.void))),
		});

		return { createStore } satisfies GraphQLRateLimitStoreServiceContract;
	}),
}) {}

export const GraphQLRateLimitStoreServiceLive = Layer.effect(
	GraphQLRateLimitStoreService,
	GraphQLRateLimitStoreService.make,
);

export const getGraphQLRateLimitStoreEffect = (windowMs: number) =>
	Effect.gen(function* () {
		const service = yield* GraphQLRateLimitStoreService;
		return service.createStore(windowMs);
	});
