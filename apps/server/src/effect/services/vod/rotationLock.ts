import { VodSetError } from "@/graphql/schema/scriptures/vodErrors";
import { Effect } from "effect";

import type { Pool, PoolClient } from "pg";

const VOD_ROTATION_LOCK_KEY = "hccna:vod:setDailyVerse";
const ACQUIRE_LOCK_QUERY = "SELECT pg_advisory_lock(hashtextextended($1, 0))";
const RELEASE_LOCK_QUERY = "SELECT pg_advisory_unlock(hashtextextended($1, 0))";

/**
 * Serialize VOD rotations on the shared Postgres cluster. Session advisory
 * locks cover Firebase, Postgres, and cache I/O, unlike a row transaction that
 * can only protect the SQL portion of the rotation.
 */
export const createVodRotationLock = (pool: Pick<Pool, "connect">) => {
	const acquire = Effect.fn("VodService.rotationLock.acquire")(function* () {
		return yield* Effect.tryPromise({
			try: async () => {
				const client = await pool.connect();
				try {
					await client.query(ACQUIRE_LOCK_QUERY, [VOD_ROTATION_LOCK_KEY]);
					return client;
				} catch (error) {
					client.release(true);
					throw error;
				}
			},
			catch: (cause) =>
				new VodSetError({
					detail: "Failed to acquire the verse-of-the-day rotation lock",
					cause,
				}),
		});
	});

	const release = Effect.fn("VodService.rotationLock.release")(function* (client: PoolClient) {
		yield* Effect.tryPromise({
			try: async () => {
				let destroyConnection = false;
				try {
					await client.query(RELEASE_LOCK_QUERY, [VOD_ROTATION_LOCK_KEY]);
				} catch (error) {
					destroyConnection = true;
					throw error;
				} finally {
					// Destroying a connection also releases its session advisory locks.
					client.release(destroyConnection);
				}
			},
			catch: (cause) =>
				new VodSetError({
					detail: "Failed to release the verse-of-the-day rotation lock",
					cause,
				}),
		}).pipe(
			Effect.catchTag("VodSetError", (error) =>
				Effect.logError("Failed to release the verse-of-the-day rotation lock").pipe(
					Effect.annotateLogs({ cause: error, lockKey: VOD_ROTATION_LOCK_KEY }),
				),
			),
		);
	});

	const withLock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.acquireUseRelease(acquire(), () => effect, release);

	return { withLock };
};
