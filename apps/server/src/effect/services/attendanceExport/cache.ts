import {
	ATTENDANCE_LRU_TTL_MS,
	ATTENDANCE_REDIS_TTL_SECONDS,
} from "@/effect/services/attendanceExport/constants";
import {
	type CachedAttendanceSnapshot,
	type EventAttendanceSnapshot,
} from "@/effect/services/attendanceExport/types";
import { DateTime, Effect } from "effect";

interface AttendanceLruClient {
	get: <T>(key: string) => Effect.Effect<T | null | undefined, unknown, never>;
	set: (
		key: string,
		value: CachedAttendanceSnapshot,
		ttlMs?: number,
	) => Effect.Effect<unknown, unknown, never>;
}

interface AttendanceRedisClient {
	get: (key: string) => Effect.Effect<string | null, unknown, never>;
	setex: (
		key: string,
		ttlSeconds: number,
		payload: string,
	) => Effect.Effect<unknown, unknown, never>;
}

/**
 * Build the lightweight cache facade shared by attendance snapshot flows.
 * Cache failures are intentionally swallowed so exports degrade to source reads.
 */
export const createAttendanceCache = (deps: {
	lru: AttendanceLruClient;
	redis: AttendanceRedisClient;
}) => {
	const getFromLru = (cacheKey: string) =>
		deps.lru.get<CachedAttendanceSnapshot>(cacheKey).pipe(Effect.catch(() => Effect.succeed(null)));

	const setToLru = (cacheKey: string, data: EventAttendanceSnapshot) =>
		Effect.gen(function* () {
			const cachedAt = DateTime.toEpochMillis(yield* DateTime.now);
			yield* deps.lru.set(
				cacheKey,
				{
					cachedAt,
					data,
				},
				ATTENDANCE_LRU_TTL_MS,
			);
		}).pipe(Effect.catch(() => Effect.void));

	const getFromRedis = (cacheKey: string) =>
		deps.redis.get(cacheKey).pipe(
			Effect.map((payload) => {
				if (!payload) {
					return null;
				}

				try {
					const entry = JSON.parse(payload) as CachedAttendanceSnapshot;
					if (!entry?.data || !entry.cachedAt) {
						return null;
					}
					return entry;
				} catch {
					return null;
				}
			}),
			Effect.catch(() => Effect.succeed(null)),
		);

	const setToRedis = (cacheKey: string, data: EventAttendanceSnapshot) =>
		Effect.gen(function* () {
			const cachedAt = DateTime.toEpochMillis(yield* DateTime.now);
			yield* deps.redis.setex(
				cacheKey,
				ATTENDANCE_REDIS_TTL_SECONDS,
				JSON.stringify({ cachedAt, data }),
			);
		}).pipe(Effect.catch(() => Effect.void));

	// Writes are fanned out so LRU and Redis stay aligned for the next lookup.
	const setBothCaches = (cacheKey: string, data: EventAttendanceSnapshot) =>
		Effect.all([setToLru(cacheKey, data), setToRedis(cacheKey, data)]).pipe(Effect.asVoid);

	return {
		getFromLru,
		getFromRedis,
		setBothCaches,
		setToLru,
	};
};
