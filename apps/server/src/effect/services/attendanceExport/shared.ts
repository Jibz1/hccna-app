import {
	ATTENDANCE_CACHE_PREFIX,
	OCCURRENCE_DATE_REGEX,
} from "@/effect/services/attendanceExport/constants";
import {
	AttendancePdfExportError,
	type AttendanceExportFormat,
	type EventAttendanceExportInput,
	type EventAttendanceLookupInput,
	type EventAttendanceSnapshot,
	type EventAttendeeStatus,
} from "@/effect/services/attendanceExport/types";
import { ExportKeySchema, type ExportKey } from "@/types/ids";
import { getTabularExportFileExtension } from "@/utils/tabularExport";
import { createHash, randomBytes } from "crypto";
import { DateTime, Effect } from "effect";

// Keep cache keys deterministic across all attendance entrypoints.
export const buildCacheKey = (ccbGroupId: string, eventId: string, occurrenceDate: string) =>
	`${ATTENDANCE_CACHE_PREFIX}:${ccbGroupId}:${eventId}:${occurrenceDate}`;

export const normalizeDate = (occurrenceDate: string): string => occurrenceDate.trim();

export const validateOccurrenceDate = (
	occurrenceDate: string,
): Effect.Effect<void, AttendancePdfExportError> =>
	Effect.gen(function* () {
		const normalized = normalizeDate(occurrenceDate);
		if (!OCCURRENCE_DATE_REGEX.test(normalized)) {
			return yield* Effect.fail(
				new AttendancePdfExportError({
					message: `Invalid occurrenceDate format: ${occurrenceDate}. Expected YYYY-MM-DD`,
				}),
			);
		}
	});

export const toHash = (value: string): string => {
	const hash = createHash("sha256");
	hash.update(value);
	return hash.digest("hex");
};

export const createOpaqueDownloadToken = (): string => randomBytes(32).toString("hex");

/**
 * Output feeds `toHash` to build export cache keys (`dataHash`, `requestFingerprint`), so
 * callers must pass objects with source-fixed key order — reordering an input literal's
 * fields changes every derived hash and silently regenerates cached exports.
 */
export const serializeJson = <Input>(value: Input): string => JSON.stringify(value);

export const isStale = (cachedAt: number, maxAgeMs: number): boolean =>
	DateTime.toEpochMillis(DateTime.nowUnsafe()) - cachedAt > maxAgeMs;

export const sortAttendees = (attendees: EventAttendeeStatus[]) =>
	attendees.toSorted((a, b) => {
		const idComparison = a.attendeeCCBID.localeCompare(b.attendeeCCBID);
		if (idComparison !== 0) {
			return idComparison;
		}
		return (a.attendeeName ?? "").localeCompare(b.attendeeName ?? "");
	});

export const toCanonicalSnapshot = (snapshot: EventAttendanceSnapshot) => ({
	attendees: sortAttendees(snapshot.attendees).map((attendee) => ({
		attended: attendee.attended,
		attendeeCCBID: attendee.attendeeCCBID,
		attendeeName: attendee.attendeeName ?? "",
	})),
	attendeesCount: snapshot.attendeesCount,
	ccbGroupId: snapshot.ccbGroupId,
	eventId: snapshot.eventId,
	eventName: snapshot.eventName,
	notes: snapshot.notes ?? "",
	occurrenceDate: snapshot.occurrenceDate,
	topic: snapshot.topic ?? "",
});

export const hasAttendanceInSnapshot = (snapshot: EventAttendanceSnapshot): boolean =>
	snapshot.attendees.length > 0 || snapshot.attendeesCount > 0;

export const hasRecordedAttendanceInSnapshot = (snapshot: EventAttendanceSnapshot): boolean =>
	snapshot.attendees.some((attendee) => attendee.attended) ||
	Boolean(snapshot.notes?.trim()) ||
	Boolean(snapshot.topic?.trim());

// Normalize and sort bulk input so hashes and cache lookups do not depend on caller order.
export const normalizeBulkInput = (input: EventAttendanceLookupInput[]) =>
	[...input]
		.map((item) => ({
			ccbGroupId: item.ccbGroupId,
			ccbId: item.ccbId,
			eventId: item.eventId,
			occurrenceDate: normalizeDate(item.occurrenceDate),
		}))
		.toSorted((a, b) => {
			const eventCompare = a.eventId.localeCompare(b.eventId);
			if (eventCompare !== 0) {
				return eventCompare;
			}

			const dateCompare = a.occurrenceDate.localeCompare(b.occurrenceDate);
			if (dateCompare !== 0) {
				return dateCompare;
			}

			return a.ccbId.localeCompare(b.ccbId);
		});

export const normalizeEventExportInput = (input: EventAttendanceExportInput[]) =>
	[
		...new Map(
			input.map((item) => {
				const normalized = {
					ccbGroupId: item.ccbGroupId,
					eventId: item.eventId,
					occurrenceDate: normalizeDate(item.occurrenceDate),
				};
				return [`${normalized.eventId}:${normalized.occurrenceDate}`, normalized] as const;
			}),
		).values(),
	].toSorted((a, b) => {
		const eventCompare = a.eventId.localeCompare(b.eventId);
		if (eventCompare !== 0) {
			return eventCompare;
		}

		return a.occurrenceDate.localeCompare(b.occurrenceDate);
	});

export const buildEventExportRequestHash = (input: EventAttendanceExportInput[]) =>
	toHash(
		serializeJson(
			normalizeEventExportInput(input).map((item) => ({
				eventId: item.eventId,
				occurrenceDate: item.occurrenceDate,
				ccbGroupId: item.ccbGroupId,
			})),
		),
	);

export const buildSingleExportKey = (
	eventId: string,
	occurrenceDate: string,
	format: AttendanceExportFormat,
) =>
	ExportKeySchema.make(
		`single:${getTabularExportFileExtension(format)}:${eventId}:${occurrenceDate}`,
	);

export const buildBulkExportKey = (requestHash: string, format: AttendanceExportFormat) =>
	ExportKeySchema.make(`bulk:${getTabularExportFileExtension(format)}:${requestHash}`);

export const buildSingleObjectPath = (
	eventId: string,
	occurrenceDate: string,
	format: AttendanceExportFormat,
) =>
	`apps/asset/attendance/single/${eventId}/${occurrenceDate}.${getTabularExportFileExtension(format)}`;

export const buildBulkObjectPath = (requestHash: string, format: AttendanceExportFormat) =>
	`apps/asset/attendance/bulk/${requestHash}.${getTabularExportFileExtension(format)}`;

export const buildAttendanceExportUrl = (exportKey: ExportKey, token: string) =>
	`/v1/attendance-exports/${encodeURIComponent(exportKey)}?token=${encodeURIComponent(token)}`;
