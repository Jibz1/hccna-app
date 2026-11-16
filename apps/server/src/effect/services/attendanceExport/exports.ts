import { EXPORT_RENDER_VERSION } from "@/effect/services/attendanceExport/constants";
import {
	getAttendanceExportRow,
	upsertAttendanceExportRow,
} from "@/effect/services/attendanceExport/repositories";
import {
	buildAttendanceExportUrl,
	buildBulkExportKey,
	buildBulkObjectPath,
	buildEventExportRequestHash,
	buildSingleExportKey,
	buildSingleObjectPath,
	createOpaqueDownloadToken,
	hasAttendanceInSnapshot,
	hasRecordedAttendanceInSnapshot,
	normalizeDate,
	normalizeEventExportInput,
	serializeJson,
	sortAttendees,
	toCanonicalSnapshot,
	toHash,
} from "@/effect/services/attendanceExport/shared";
import { doesExportFileExist, uploadExportFile } from "@/effect/services/attendanceExport/storage";
import {
	AttendancePdfExportError,
	type AttendanceExportFormat,
	type AttendancePdfExportResult,
	type EventAttendanceExportInput,
	type EventAttendanceLookupInput,
	type EventAttendanceSnapshot,
} from "@/effect/services/attendanceExport/types";
import { DrizzleService } from "@/effect/services/DrizzleService";
import {
	createSectionedTabularExportFile,
	createTabularExportFile,
	type SectionedTabularExportSection,
} from "@/utils/tabularExport";
import { Effect } from "effect";

import type { ExportStorageService } from "@/effect/services/ExportStorageService";

const BASE_URL = "https://api.hccnj.org";

interface ExportDeps {
	drizzle: typeof DrizzleService.Service;
	getEventAttendeesSnapshot: (
		params: Pick<EventAttendanceLookupInput, "ccbGroupId" | "eventId" | "occurrenceDate">,
	) => Effect.Effect<EventAttendanceSnapshot, AttendancePdfExportError>;
	warnDbFailure: (
		operation: string,
		cause: unknown,
		meta?: Record<string, string>,
	) => Effect.Effect<void, never, never>;
}

// Keep file creation behind a local wrapper so this module owns export shaping.
const createAttendanceExportFile = (params: {
	details?: string[];
	format: AttendanceExportFormat;
	headers: string[];
	rows: string[][];
	subtitle: string;
	title: string;
}) => createTabularExportFile(params);

const createGroupedAttendanceExportFile = (params: {
	details?: string[];
	format: AttendanceExportFormat;
	sections: SectionedTabularExportSection[];
	subtitle: string;
	title: string;
}) => createSectionedTabularExportFile(params);

const createSingleDetails = (snapshot: EventAttendanceSnapshot): string[] => {
	const details: string[] = [];
	if (snapshot.topic) {
		details.push(`Topic: ${snapshot.topic}`);
	}
	if (snapshot.notes) {
		details.push(`Notes: ${snapshot.notes}`);
	}
	return details;
};

const formatAttendanceSummary = (attendedCount: number, totalCount: number) => {
	const percentage = totalCount > 0 ? Math.round((attendedCount / totalCount) * 100) : 0;
	return `${attendedCount}/${totalCount} (${percentage}%)`;
};

const createBulkSections = (
	input: EventAttendanceExportInput[],
	snapshotByKey: Map<string, EventAttendanceSnapshot>,
): SectionedTabularExportSection[] =>
	input.map((item) => {
		const snapshot = snapshotByKey.get(`${item.eventId}:${item.occurrenceDate}`);
		const eventName = snapshot?.eventName || item.eventId;
		const details = [
			...(snapshot?.topic ? [`Topic: ${snapshot.topic}`] : []),
			...(snapshot?.notes ? [`Notes: ${snapshot.notes}`] : []),
		];
		const attendedCount = snapshot?.attendees.filter((attendee) => attendee.attended).length ?? 0;
		const totalCount = snapshot?.attendeesCount ?? 0;
		const rows = snapshot?.attendees
			? sortAttendees(snapshot.attendees)
					.filter((attendee) => attendee.attended && Boolean(attendee.attendeeName?.trim()))
					.map((attendee) => [attendee.attendeeCCBID, attendee.attendeeName ?? ""])
			: [];
		const section: SectionedTabularExportSection = {
			headers: ["CCB ID", "Name"],
			rows,
			subtitle: `CCB Event ID: ${item.eventId} | CCB Group ID: ${item.ccbGroupId} | Date: ${item.occurrenceDate} | Attendance: ${formatAttendanceSummary(attendedCount, totalCount)}`,
			title: `Event Attendance Export - ${eventName}`,
		};

		if (details.length > 0) {
			section.details = details;
		}

		if (rows.length === 0) {
			section.emptyMessage =
				snapshot && hasRecordedAttendanceInSnapshot(snapshot)
					? "No attendees marked attended"
					: "No event recorded";
		}

		return section;
	});

/**
 * Assemble the export API used by attendance GraphQL mutations.
 */
export const createAttendanceExportApi = (deps: ExportDeps) => {
	const exportEventAttendeesPdf = (
		params: Pick<EventAttendanceLookupInput, "ccbGroupId" | "eventId" | "occurrenceDate">,
		format: AttendanceExportFormat = "PDF",
	): Effect.Effect<AttendancePdfExportResult, AttendancePdfExportError, ExportStorageService> =>
		Effect.gen(function* () {
			const snapshot = yield* deps.getEventAttendeesSnapshot(params);
			const occurrenceDate = normalizeDate(params.occurrenceDate);
			if (!hasAttendanceInSnapshot(snapshot)) {
				return yield* Effect.fail(
					new AttendancePdfExportError({
						message: `No attendance found for event ${params.eventId} on ${occurrenceDate}. Export skipped.`,
					}),
				);
			}

			const exportKey = buildSingleExportKey(params.eventId, occurrenceDate, format);
			// Keep renderVersion in the hash so layout/rules changes regenerate stale files.
			const dataHash = toHash(
				serializeJson({
					format,
					renderVersion: EXPORT_RENDER_VERSION,
					snapshot: toCanonicalSnapshot(snapshot),
				}),
			);
			const requestFingerprint = `${params.eventId}|${occurrenceDate}|${format}`;

			const existingResult = yield* Effect.result(
				getAttendanceExportRow(exportKey).pipe(Effect.provideService(DrizzleService, deps.drizzle)),
			);
			const existing = existingResult._tag === "Success" ? existingResult.success : null;
			if (existingResult._tag === "Failure") {
				yield* deps.warnDbFailure(
					"Postgres attendance export metadata read",
					existingResult.failure,
					{
						eventId: params.eventId,
						occurrenceDate,
						exportKey,
					},
				);
			}
			if (
				existing &&
				existing.dataHash === dataHash &&
				existing.downloadTokenHash &&
				existing.publicUrl
			) {
				const fileStillExists = yield* Effect.result(
					doesExportFileExist(existing.gcsBucket, existing.gcsObjectPath),
				);
				if (fileStillExists._tag === "Success" && fileStillExists.success) {
					// Reuse a previous export when both the normalized payload and render version match.
					return {
						dataHash,
						exportKey,
						format,
						generated: false,
						lastGeneratedAt: new Date(existing.lastGeneratedAt),
						url: `${BASE_URL}${existing.publicUrl}`,
					};
				}
			}

			const rows = sortAttendees(snapshot.attendees)
				.filter((attendee) => attendee.attended && Boolean(attendee.attendeeName?.trim()))
				.map((attendee) => [attendee.attendeeCCBID, attendee.attendeeName ?? ""]);
			const attendedCount = snapshot.attendees.filter((attendee) => attendee.attended).length;
			if (rows.length === 0) {
				return yield* Effect.fail(
					new AttendancePdfExportError({
						message: `No attended attendees found for event ${params.eventId} on ${occurrenceDate}. Export skipped.`,
					}),
				);
			}

			const exportBytes = yield* Effect.tryPromise({
				try: () =>
					createAttendanceExportFile({
						details: createSingleDetails(snapshot),
						format,
						headers: ["CCB ID", "Name"],
						rows,
						subtitle: `CCB Event ID: ${snapshot.eventId} | CCB Group ID: ${snapshot.ccbGroupId} | Date: ${snapshot.occurrenceDate} | Attendance: ${formatAttendanceSummary(attendedCount, snapshot.attendeesCount)}`,
						title: `Event Attendance Export - ${snapshot.eventName || params.eventId}`,
					}),
				catch: (error) =>
					new AttendancePdfExportError({
						cause: error,
						message: "Failed to generate attendance export file",
					}),
			});

			const objectPath = buildSingleObjectPath(params.eventId, occurrenceDate, format);
			const reusedPrivateUrl =
				existing?.dataHash === dataHash && existing.downloadTokenHash && existing.publicUrl
					? existing.publicUrl
					: null;
			const reusedDownloadTokenHash =
				existing?.dataHash === dataHash && existing.downloadTokenHash
					? existing.downloadTokenHash
					: null;
			const downloadToken =
				reusedPrivateUrl && reusedDownloadTokenHash ? null : createOpaqueDownloadToken();
			const privateUrl =
				reusedPrivateUrl ?? buildAttendanceExportUrl(exportKey, downloadToken as string);
			const downloadTokenHash = reusedDownloadTokenHash ?? toHash(downloadToken as string);
			yield* uploadExportFile(objectPath, exportBytes, format);

			const rowResult = yield* Effect.result(
				upsertAttendanceExportRow({
					dataHash,
					downloadTokenHash,
					exportKey,
					objectPath,
					publicUrl: privateUrl,
					queryType: "single_event",
					requestFingerprint,
				}).pipe(Effect.provideService(DrizzleService, deps.drizzle)),
			);
			if (rowResult._tag === "Failure") {
				return yield* Effect.fail(rowResult.failure);
			}
			const row = rowResult.success;

			return {
				dataHash,
				exportKey,
				format,
				generated: true,
				lastGeneratedAt: new Date(row.lastGeneratedAt),
				url: `${BASE_URL}${privateUrl}`,
			};
		}).pipe(Effect.withSpan("AttendanceExportService.exportEventAttendeesPdf"));

	const exportEventAttendancePdf = (
		input: EventAttendanceExportInput[],
		format: AttendanceExportFormat = "PDF",
	): Effect.Effect<AttendancePdfExportResult, AttendancePdfExportError, ExportStorageService> =>
		Effect.gen(function* () {
			if (input.length === 0) {
				return yield* Effect.fail(
					new AttendancePdfExportError({
						message: "Input cannot be empty for exportEventAttendancePdf",
					}),
				);
			}

			const normalizedInput = normalizeEventExportInput(input);
			const requestHash = buildEventExportRequestHash(normalizedInput);
			const exportKey = buildBulkExportKey(requestHash, format);
			const requestFingerprint = serializeJson({
				format,
				input: normalizedInput.map((item) => ({
					eventId: item.eventId,
					occurrenceDate: item.occurrenceDate,
				})),
			});
			const snapshots = yield* Effect.forEach(
				normalizedInput,
				(item) =>
					deps.getEventAttendeesSnapshot({
						ccbGroupId: item.ccbGroupId,
						eventId: item.eventId,
						occurrenceDate: item.occurrenceDate,
					}),
				{ concurrency: 8 },
			);
			const snapshotByKey = new Map(
				snapshots.map(
					(snapshot) => [`${snapshot.eventId}:${snapshot.occurrenceDate}`, snapshot] as const,
				),
			);
			const sections = createBulkSections(normalizedInput, snapshotByKey);

			const dataHash = toHash(
				serializeJson({
					format,
					renderVersion: EXPORT_RENDER_VERSION,
					sections,
				}),
			);

			const existingResult = yield* Effect.result(
				getAttendanceExportRow(exportKey).pipe(Effect.provideService(DrizzleService, deps.drizzle)),
			);
			const existing = existingResult._tag === "Success" ? existingResult.success : null;
			if (existingResult._tag === "Failure") {
				yield* deps.warnDbFailure(
					"Postgres attendance export metadata read",
					existingResult.failure,
					{
						exportKey,
						requestHash,
					},
				);
			}
			if (
				existing &&
				existing.dataHash === dataHash &&
				existing.downloadTokenHash &&
				existing.publicUrl
			) {
				const fileStillExists = yield* Effect.result(
					doesExportFileExist(existing.gcsBucket, existing.gcsObjectPath),
				);
				if (fileStillExists._tag === "Success" && fileStillExists.success) {
					return {
						dataHash,
						exportKey,
						format,
						generated: false,
						lastGeneratedAt: new Date(existing.lastGeneratedAt),
						url: `${BASE_URL}${existing.publicUrl}`,
					};
				}
			}

			const exportBytes = yield* Effect.tryPromise({
				try: () =>
					createGroupedAttendanceExportFile({
						format,
						sections,
						subtitle: `Events: ${normalizedInput.length}`,
						title: "Bulk Event Attendance Export",
					}),
				catch: (error) =>
					new AttendancePdfExportError({
						cause: error,
						message: "Failed to generate bulk attendance export file",
					}),
			});

			const objectPath = buildBulkObjectPath(requestHash, format);
			const reusedPrivateUrl =
				existing?.dataHash === dataHash && existing.downloadTokenHash && existing.publicUrl
					? existing.publicUrl
					: null;
			const reusedDownloadTokenHash =
				existing?.dataHash === dataHash && existing.downloadTokenHash
					? existing.downloadTokenHash
					: null;
			const downloadToken =
				reusedPrivateUrl && reusedDownloadTokenHash ? null : createOpaqueDownloadToken();
			const privateUrl =
				reusedPrivateUrl ?? buildAttendanceExportUrl(exportKey, downloadToken as string);
			const downloadTokenHash = reusedDownloadTokenHash ?? toHash(downloadToken as string);
			yield* uploadExportFile(objectPath, exportBytes, format);

			const rowResult = yield* Effect.result(
				upsertAttendanceExportRow({
					dataHash,
					downloadTokenHash,
					exportKey,
					objectPath,
					publicUrl: privateUrl,
					queryType: "bulk_event",
					requestFingerprint,
				}).pipe(Effect.provideService(DrizzleService, deps.drizzle)),
			);
			if (rowResult._tag === "Failure") {
				return yield* Effect.fail(rowResult.failure);
			}
			const row = rowResult.success;

			return {
				dataHash,
				exportKey,
				format,
				generated: true,
				lastGeneratedAt: new Date(row.lastGeneratedAt),
				url: `${BASE_URL}${privateUrl}`,
			};
		}).pipe(Effect.withSpan("AttendanceExportService.exportEventAttendancePdf"));

	return {
		exportEventAttendancePdf,
		exportEventAttendeesPdf,
	};
};
