import { Schema } from "effect";

import type { ExportKey } from "@/types/ids";
import type { TabularExportFormat } from "@/utils/tabularExport";

export interface CachedAttendanceSnapshot {
	cachedAt: number;
	data: EventAttendanceSnapshot;
}

export interface EventAttendeeStatus {
	attended: boolean;
	attendeeCCBID: string;
	attendeeName?: string | undefined;
}

export interface EventAttendanceSnapshot {
	attendees: EventAttendeeStatus[];
	attendeesCount: number;
	ccbGroupId: string;
	eventId: string;
	eventName: string;
	notes?: string | undefined;
	occurrenceDate: string;
	topic?: string | undefined;
}

export interface EventAttendanceLookupInput {
	ccbGroupId: string;
	ccbId: string;
	eventId: string;
	occurrenceDate: string;
}

export interface EventAttendanceExportInput {
	ccbGroupId: string;
	eventId: string;
	occurrenceDate: string;
}

export interface EventAttendanceLookupResult {
	attended: boolean;
	attendeeName?: string | undefined;
	ccbId: string;
	eventId: string;
	foundInGroup?: boolean;
	occurrenceDate: string;
	sourceEventName?: string;
	sourceNotes?: string;
	sourceTopic?: string;
}

export interface AttendancePdfExportResult {
	dataHash: string;
	exportKey: ExportKey;
	format: AttendanceExportFormat;
	generated: boolean;
	lastGeneratedAt: Date;
	url: string;
}

export type AttendanceExportFormat = TabularExportFormat;

export class AttendancePdfExportError extends Schema.TaggedError<AttendancePdfExportError>()(
	"AttendancePdfExportError",
	{
		cause: Schema.optional(Schema.Unknown),
		message: Schema.String,
	},
) {}
