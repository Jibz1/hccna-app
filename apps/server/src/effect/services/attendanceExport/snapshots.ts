import { createAttendanceCache } from "@/effect/services/attendanceExport/cache";
import { fetchAttendanceSnapshotFromCcb } from "@/effect/services/attendanceExport/ccb";
import {
	ATTENDANCE_DB_STALE_AFTER_MS,
	BULK_CONCURRENCY_LIMIT,
} from "@/effect/services/attendanceExport/constants";
import {
	fetchAttendanceSnapshotFromDb,
	persistAttendanceSnapshotToDb,
} from "@/effect/services/attendanceExport/repositories";
import {
	buildCacheKey,
	isStale,
	normalizeBulkInput,
	normalizeDate,
	validateOccurrenceDate,
} from "@/effect/services/attendanceExport/shared";
import {
	AttendancePdfExportError,
	type EventAttendanceLookupInput,
	type EventAttendanceLookupResult,
	type EventAttendanceSnapshot,
} from "@/effect/services/attendanceExport/types";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { Effect, type Scope } from "effect";

import type { LRUService } from "@/effect/LRUService";
import type { RedisService } from "@/effect/RedisService";
import type { CCBService } from "@/effect/services/CCBService";

interface SnapshotDeps {
	scope: Scope.Scope;
	ccb: typeof CCBService.Service;
	drizzle: typeof DrizzleService.Service;
	lru: typeof LRUService.Service;
	redis: typeof RedisService.Service;
	warnDbFailure: (
		operation: string,
		cause: unknown,
		meta?: Record<string, string>,
	) => Effect.Effect<void, never, never>;
}

/**
 * Assemble the snapshot read API used by attendance queries and export jobs.
 */
export const createAttendanceSnapshotApi = (deps: SnapshotDeps) => {
	const refreshing = new Set<string>();
	const cache = createAttendanceCache({
		lru: deps.lru,
		redis: deps.redis,
	});

	// The service owns refreshes so returning a stale snapshot does not cancel them.
	// Scope closure interrupts outstanding work before the service dependencies close.
	const refreshSnapshotInBackground = (
		params: Pick<EventAttendanceLookupInput, "ccbGroupId" | "eventId" | "occurrenceDate">,
	) => {
		const cacheKey = buildCacheKey(params.ccbGroupId, params.eventId, params.occurrenceDate);
		const refresh = Effect.gen(function* () {
			const fresh = yield* fetchAttendanceSnapshotFromCcb(deps.ccb, params);
			yield* persistAttendanceSnapshotToDb(fresh).pipe(
				Effect.provideService(DrizzleService, deps.drizzle),
			);
			yield* cache.setBothCaches(cacheKey, fresh);
		}).pipe(
			Effect.timeout("2 minutes"),
			Effect.catch((error) =>
				Effect.logWarning("Background attendance refresh failed").pipe(
					Effect.annotateLogs({
						error: String(error),
						eventId: params.eventId,
						occurrenceDate: params.occurrenceDate,
					}),
					Effect.asVoid,
				),
			),
		);

		// Claim and release the key inside the background fiber so interruption
		// cannot leave a claim behind between admission and finalizer registration.
		return Effect.acquireUseRelease(
			Effect.sync(() => {
				if (refreshing.has(cacheKey)) {
					return false;
				}
				refreshing.add(cacheKey);
				return true;
			}),
			(claimed) => (claimed ? refresh : Effect.void),
			(claimed) =>
				Effect.sync(() => {
					if (claimed) {
						refreshing.delete(cacheKey);
					}
				}),
		).pipe(Effect.forkIn(deps.scope), Effect.asVoid);
	};

	const getEventAttendeesSnapshot = (
		params: Pick<EventAttendanceLookupInput, "ccbGroupId" | "eventId" | "occurrenceDate">,
	): Effect.Effect<EventAttendanceSnapshot, AttendancePdfExportError> =>
		Effect.gen(function* () {
			yield* validateOccurrenceDate(params.occurrenceDate);

			const occurrenceDate = normalizeDate(params.occurrenceDate);
			const cacheKey = buildCacheKey(params.ccbGroupId, params.eventId, occurrenceDate);
			const rehydrateSnapshotIfNeeded = (
				snapshot: EventAttendanceSnapshot,
			): Effect.Effect<EventAttendanceSnapshot, AttendancePdfExportError> =>
				Effect.gen(function* () {
					// Older/stale DB rows can report attendeesCount > 0 with empty attendee rows.
					// Rehydrate from CCB once so exports never emit empty files for non-empty events.
					if (snapshot.attendees.length > 0 || snapshot.attendeesCount === 0) {
						return snapshot;
					}

					const fresh = yield* fetchAttendanceSnapshotFromCcb(deps.ccb, {
						...params,
						occurrenceDate,
					});
					yield* persistAttendanceSnapshotToDb(fresh).pipe(
						Effect.provideService(DrizzleService, deps.drizzle),
						Effect.catch((error) =>
							deps.warnDbFailure("Postgres attendance snapshot persist", error, {
								eventId: params.eventId,
								occurrenceDate,
							}),
						),
					);
					yield* cache.setBothCaches(cacheKey, fresh);
					return fresh;
				});

			// Cache order is LRU -> Redis -> Postgres -> CCB.
			const lruEntry = yield* cache.getFromLru(cacheKey);
			if (lruEntry?.data) {
				if (isStale(lruEntry.cachedAt, ATTENDANCE_DB_STALE_AFTER_MS)) {
					yield* refreshSnapshotInBackground({
						...params,
						occurrenceDate,
					});
				}
				return yield* rehydrateSnapshotIfNeeded(lruEntry.data);
			}

			const redisEntry = yield* cache.getFromRedis(cacheKey);
			if (redisEntry?.data) {
				yield* cache.setToLru(cacheKey, redisEntry.data);
				if (isStale(redisEntry.cachedAt, ATTENDANCE_DB_STALE_AFTER_MS)) {
					yield* refreshSnapshotInBackground({
						...params,
						occurrenceDate,
					});
				}
				return yield* rehydrateSnapshotIfNeeded(redisEntry.data);
			}

			const dbEntryResult = yield* Effect.result(
				fetchAttendanceSnapshotFromDb(params.ccbGroupId, params.eventId, occurrenceDate).pipe(
					Effect.provideService(DrizzleService, deps.drizzle),
				),
			);
			const dbEntry = dbEntryResult._tag === "Success" ? dbEntryResult.success : null;
			if (dbEntryResult._tag === "Failure") {
				yield* deps.warnDbFailure("Postgres attendance snapshot read", dbEntryResult.failure, {
					eventId: params.eventId,
					occurrenceDate,
				});
			}
			if (dbEntry?.snapshot) {
				yield* cache.setBothCaches(cacheKey, dbEntry.snapshot);
				if (dbEntry.stale) {
					yield* refreshSnapshotInBackground({
						...params,
						occurrenceDate,
					});
				}
				return yield* rehydrateSnapshotIfNeeded(dbEntry.snapshot);
			}

			const fresh = yield* fetchAttendanceSnapshotFromCcb(deps.ccb, {
				...params,
				occurrenceDate,
			});
			yield* persistAttendanceSnapshotToDb(fresh).pipe(
				Effect.provideService(DrizzleService, deps.drizzle),
				Effect.catch((error) =>
					deps.warnDbFailure("Postgres attendance snapshot persist", error, {
						eventId: params.eventId,
						occurrenceDate,
					}),
				),
			);
			yield* cache.setBothCaches(cacheKey, fresh);
			return fresh;
		}).pipe(Effect.withSpan("AttendanceExportService.getEventAttendeesSnapshot"));

	const getEventAttendanceByCcb = (
		input: EventAttendanceLookupInput[],
	): Effect.Effect<EventAttendanceLookupResult[], AttendancePdfExportError> =>
		Effect.gen(function* () {
			if (input.length === 0) {
				return [];
			}

			const normalized = normalizeBulkInput(input);
			for (const item of normalized) {
				yield* validateOccurrenceDate(item.occurrenceDate);
			}

			const uniqueEventOccurrenceMap = new Map<
				string,
				Pick<EventAttendanceLookupInput, "ccbGroupId" | "eventId" | "occurrenceDate">
			>();

			for (const item of normalized) {
				const key = `${item.ccbGroupId}:${item.eventId}:${item.occurrenceDate}`;
				if (!uniqueEventOccurrenceMap.has(key)) {
					uniqueEventOccurrenceMap.set(key, {
						ccbGroupId: item.ccbGroupId,
						eventId: item.eventId,
						occurrenceDate: item.occurrenceDate,
					});
				}
			}

			const uniqueRequests = [...uniqueEventOccurrenceMap.values()];
			const snapshots = yield* Effect.forEach(
				uniqueRequests,
				(request) => getEventAttendeesSnapshot(request),
				{ concurrency: BULK_CONCURRENCY_LIMIT },
			);

			const toLookupResults = (
				lookupSnapshots: EventAttendanceSnapshot[],
			): Effect.Effect<EventAttendanceLookupResult[], AttendancePdfExportError> => {
				const snapshotByKey = new Map(
					lookupSnapshots.map((snapshot) => {
						const attendeesById = new Map<string, EventAttendanceSnapshot["attendees"][number]>();
						for (const attendee of snapshot.attendees) {
							if (!attendeesById.has(attendee.attendeeCCBID)) {
								attendeesById.set(attendee.attendeeCCBID, attendee);
							}
						}
						return [
							`${snapshot.ccbGroupId}:${snapshot.eventId}:${snapshot.occurrenceDate}`,
							{ snapshot, attendeesById },
						] as const;
					}),
				);
				return Effect.gen(function* () {
					const results: EventAttendanceLookupResult[] = [];
					for (const item of input) {
						const normalizedDate = normalizeDate(item.occurrenceDate);
						const entry = snapshotByKey.get(`${item.ccbGroupId}:${item.eventId}:${normalizedDate}`);

						if (!entry) {
							return yield* Effect.fail(
								new AttendancePdfExportError({
									message: `No attendance snapshot available for event ${item.eventId} on ${normalizedDate}`,
								}),
							);
						}

						// Preserve source metadata on lookup results so bulk exports can
						// include notes/topic rows without refetching snapshots later.
						const { snapshot, attendeesById } = entry;
						const attendee = attendeesById.get(item.ccbId);
						const lookupResult: EventAttendanceLookupResult = {
							attended: attendee?.attended ?? false,
							attendeeName: attendee?.attendeeName,
							ccbId: item.ccbId,
							eventId: item.eventId,
							foundInGroup: Boolean(attendee),
							occurrenceDate: normalizedDate,
						};
						if (snapshot.eventName) {
							lookupResult.sourceEventName = snapshot.eventName;
						}
						if (snapshot.notes) {
							lookupResult.sourceNotes = snapshot.notes;
						}
						if (snapshot.topic) {
							lookupResult.sourceTopic = snapshot.topic;
						}
						results.push(lookupResult);
					}
					return results;
				});
			};

			const initialResults = yield* toLookupResults(snapshots);
			if (initialResults.some((result) => result.foundInGroup)) {
				return initialResults;
			}

			// Avoid a stale negative: when every lookup misses, force one full refresh pass.
			const freshSnapshots = yield* Effect.forEach(
				uniqueRequests,
				(request) =>
					Effect.gen(function* () {
						const fresh = yield* fetchAttendanceSnapshotFromCcb(deps.ccb, request);
						yield* persistAttendanceSnapshotToDb(fresh).pipe(
							Effect.provideService(DrizzleService, deps.drizzle),
							Effect.catch((error) =>
								deps.warnDbFailure("Postgres attendance snapshot persist", error, {
									eventId: request.eventId,
									occurrenceDate: request.occurrenceDate,
								}),
							),
						);
						yield* cache.setBothCaches(
							buildCacheKey(request.ccbGroupId, request.eventId, request.occurrenceDate),
							fresh,
						);
						return fresh;
					}),
				{ concurrency: BULK_CONCURRENCY_LIMIT },
			);

			return yield* toLookupResults(freshSnapshots);
		}).pipe(Effect.withSpan("AttendanceExportService.getEventAttendanceByCcb"));

	return {
		getEventAttendanceByCcb,
		getEventAttendeesSnapshot,
	};
};
