import { makeMockRedis, makeRedisTestLayer } from "@/effect/services/__tests__/fixtures";
import { Effect } from "effect";

const fail = (operation: string) =>
	Effect.fail({ _tag: "RedisError", operation, message: `Redis ${operation} failed` } as const);

/**
 * In-memory RedisService for tests: get, mget, setex, incr and del use `store`, and keys
 * matches a pattern with a trailing `*`. With `failing`, those six calls fail with a
 * RedisError, like an unreachable Redis. Every other method is makeMockRedis's stub, which
 * succeeds (failing or not) and never touches `store`.
 */
export const makeMemoryRedis = (failing = false) => {
	const store = new Map<string, string>();
	const redis = makeMockRedis({
		get: (key: string) => (failing ? fail("get") : Effect.succeed(store.get(key) ?? null)),
		mget: (keys: string[]) =>
			failing ? fail("mget") : Effect.sync(() => keys.map((key) => store.get(key) ?? null)),
		setex: (key: string, _seconds: number, value: string) =>
			failing
				? fail("setex")
				: Effect.sync(() => {
						store.set(key, value);
					}),
		incr: (key: string) =>
			failing
				? fail("incr")
				: Effect.sync(() => {
						const next = Number(store.get(key) ?? "0") + 1;
						store.set(key, String(next));
						return next;
					}),
		del: (key: string) =>
			failing
				? fail("del")
				: Effect.sync(() => {
						store.delete(key);
					}),
		keys: (pattern: string) =>
			failing
				? fail("keys")
				: Effect.succeed(
						[...store.keys()].filter((key) => key.startsWith(pattern.replace(/\*$/u, ""))),
					),
	});
	return { store, layer: makeRedisTestLayer(redis) };
};
