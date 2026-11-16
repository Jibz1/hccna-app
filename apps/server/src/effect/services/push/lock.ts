import { PushTokenRegistrationError } from "@/effect/services/push/errors";
import { Effect } from "effect";

import type { Pool } from "pg";

export const createPushTokenLock = (pool: Pick<Pool, "connect">) => {
	const withLock = <A, E, R>(token: string, effect: Effect.Effect<A, E, R>) =>
		Effect.acquireUseRelease(
			Effect.tryPromise({
				try: () => pool.connect(),
				catch: (cause) =>
					new PushTokenRegistrationError({
						detail: "Unable to acquire push registration connection",
						cause,
					}),
			}),
			(client) =>
				Effect.gen(function* () {
					const result = yield* Effect.tryPromise({
						try: () =>
							client.query<{ locked: boolean }>(
								"SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
								[`push-token:${token}`],
							),
						catch: (cause) =>
							new PushTokenRegistrationError({ detail: "Unable to lock push registration", cause }),
					});
					if (!result.rows[0]?.locked) {
						return yield* new PushTokenRegistrationError({
							detail: "Push registration is already synchronizing",
						});
					}
					// Do not release the lock while an uncancellable Firebase request is still running.
					return yield* Effect.uninterruptible(effect);
				}),
			(client) => Effect.sync(() => client.release(true)),
		);
	return { withLock };
};
