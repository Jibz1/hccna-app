import {
	attendancePdfExports,
	eventAttendanceEntries,
	eventAttendanceSummaries,
} from "@/db/schema";
import {
	ATTENDANCE_DB_STALE_AFTER_MS,
	EXPORT_BUCKET,
} from "@/effect/services/attendanceExport/constants";
import { isStale } from "@/effect/services/attendanceExport/shared";
import {
	AttendancePdfExportError,
	type EventAttendanceSnapshot,
	type EventAttendeeStatus,
} from "@/effect/services/attendanceExport/types";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { ExportKey } from "@/types/ids";

// Store attendance snapshots as one summary row plus attendee rows.
export const fetchAttendanceSnapshotFromDb = (
	ccbGroupId: string,
	eventId: string,
	occurrenceDate: string,
): Effect.Effect<
	{ snapshot: EventAttendanceSnapshot; stale: boolean } | null,
	AttendancePdfExportError,
	DrizzleService
> =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		return yield* Effect.tryPromise({
			try: async () => {
				const [summary] = await db
					.select()
					.from(eventAttendanceSummaries)
					.where(
						and(
							eq(eventAttendanceSummaries.ccbGroupId, ccbGroupId),
							eq(eventAttendanceSummaries.eventId, eventId),
							eq(eventAttendanceSummaries.occurrenceDate, occurrenceDate),
						),
					)
					.limit(1);

				if (!summary) {
					return null;
				}

				const rows = await db
					.select()
					.from(eventAttendanceEntries)
					.where(
						and(
							eq(eventAttendanceEntries.ccbGroupId, ccbGroupId),
							eq(eventAttendanceEntries.eventId, eventId),
							eq(eventAttendanceEntries.occurrenceDate, occurrenceDate),
						),
					)
					.orderBy(
						asc(eventAttendanceEntries.attendeeName),
						asc(eventAttendanceEntries.attendeeCcbId),
					);

				const snapshotAttendees: EventAttendeeStatus[] = rows.map((row) => {
					if (row.attendeeName) {
						return {
							attended: row.attended,
							attendeeCCBID: row.attendeeCcbId,
							attendeeName: row.attendeeName,
						};
					}

					return {
						attended: row.attended,
						attendeeCCBID: row.attendeeCcbId,
					};
				});

				const snapshot: EventAttendanceSnapshot = {
					attendees: snapshotAttendees,
					attendeesCount: summary.attendeesCount,
					ccbGroupId: summary.ccbGroupId,
					eventId: summary.eventId,
					eventName: summary.eventName,
					occurrenceDate: summary.occurrenceDate,
				};
				if (summary.notes) {
					snapshot.notes = summary.notes;
				}
				if (summary.topic) {
					snapshot.topic = summary.topic;
				}

				const stale =
					summary.isStale ||
					isStale(new Date(summary.lastSyncedAt).getTime(), ATTENDANCE_DB_STALE_AFTER_MS);

				return { snapshot, stale };
			},
			catch: (error) =>
				new AttendancePdfExportError({
					cause: error,
					message: "Failed to read event attendance snapshot from Postgres",
				}),
		});
	});

export const persistAttendanceSnapshotToDb = (snapshot: EventAttendanceSnapshot) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		return yield* Effect.tryPromise({
			try: async () => {
				await db.transaction(async (tx) => {
					await tx
						.insert(eventAttendanceSummaries)
						.values({
							attendeesCount: snapshot.attendeesCount,
							ccbGroupId: snapshot.ccbGroupId,
							eventId: snapshot.eventId,
							eventName: snapshot.eventName,
							isStale: false,
							lastSyncedAt: new Date(),
							notes: snapshot.notes,
							occurrenceDate: snapshot.occurrenceDate,
							topic: snapshot.topic,
						})
						.onConflictDoUpdate({
							target: [
								eventAttendanceSummaries.ccbGroupId,
								eventAttendanceSummaries.eventId,
								eventAttendanceSummaries.occurrenceDate,
							],
							set: {
								attendeesCount: snapshot.attendeesCount,
								ccbGroupId: snapshot.ccbGroupId,
								eventName: snapshot.eventName,
								isStale: false,
								lastSyncedAt: new Date(),
								notes: snapshot.notes,
								topic: snapshot.topic,
								updatedAt: new Date(),
							},
						});

					// Replace attendee rows wholesale so the stored snapshot stays exact.
					await tx
						.delete(eventAttendanceEntries)
						.where(
							and(
								eq(eventAttendanceEntries.ccbGroupId, snapshot.ccbGroupId),
								eq(eventAttendanceEntries.eventId, snapshot.eventId),
								eq(eventAttendanceEntries.occurrenceDate, snapshot.occurrenceDate),
							),
						);

					if (snapshot.attendees.length > 0) {
						await tx.insert(eventAttendanceEntries).values(
							snapshot.attendees.map((attendee) => ({
								attended: attendee.attended,
								attendeeCcbId: attendee.attendeeCCBID,
								attendeeName: attendee.attendeeName,
								ccbGroupId: snapshot.ccbGroupId,
								eventId: snapshot.eventId,
								occurrenceDate: snapshot.occurrenceDate,
							})),
						);
					}
				});
			},
			catch: (error) =>
				new AttendancePdfExportError({
					cause: error,
					message: "Failed to persist event attendance snapshot to Postgres",
				}),
		});
	});

export const getAttendanceExportRow = (exportKey: ExportKey) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		return yield* Effect.tryPromise({
			try: async () => {
				const [row] = await db
					.select()
					.from(attendancePdfExports)
					.where(eq(attendancePdfExports.exportKey, exportKey))
					.limit(1);
				return row ?? null;
			},
			catch: (error) =>
				new AttendancePdfExportError({
					cause: error,
					message: "Failed to fetch attendance PDF export metadata",
				}),
		});
	});

export const upsertAttendanceExportRow = (params: {
	dataHash: string;
	downloadTokenHash: string;
	exportKey: ExportKey;
	objectPath: string;
	publicUrl: string;
	queryType: "bulk_event" | "bulk_lookup" | "single_event";
	requestFingerprint: string;
}) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		return yield* Effect.tryPromise({
			try: async () => {
				const [row] = await db
					.insert(attendancePdfExports)
					.values({
						// Persist reuse metadata for identical requests against identical source data.
						dataHash: params.dataHash,
						downloadTokenHash: params.downloadTokenHash,
						exportKey: params.exportKey,
						gcsBucket: EXPORT_BUCKET,
						gcsObjectPath: params.objectPath,
						lastGeneratedAt: new Date(),
						publicUrl: params.publicUrl,
						queryType: params.queryType,
						requestFingerprint: params.requestFingerprint,
					})
					.onConflictDoUpdate({
						target: attendancePdfExports.exportKey,
						set: {
							dataHash: params.dataHash,
							downloadTokenHash: params.downloadTokenHash,
							gcsBucket: EXPORT_BUCKET,
							gcsObjectPath: params.objectPath,
							lastGeneratedAt: new Date(),
							publicUrl: params.publicUrl,
							queryType: params.queryType,
							requestFingerprint: params.requestFingerprint,
							updatedAt: new Date(),
						},
					})
					.returning();

				if (!row) {
					throw new Error("Failed to persist attendance PDF export metadata");
				}
				return row;
			},
			catch: (error) =>
				new AttendancePdfExportError({
					cause: error,
					message: "Failed to upsert attendance PDF export metadata",
				}),
		});
	});
