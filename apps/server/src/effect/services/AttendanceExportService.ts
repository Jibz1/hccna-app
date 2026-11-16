import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { createAttendanceExportApi } from "@/effect/services/attendanceExport/exports";
import { createAttendanceSnapshotApi } from "@/effect/services/attendanceExport/snapshots";
import {
	type AttendanceExportFormat,
	type AttendancePdfExportError,
	type AttendancePdfExportResult,
	type EventAttendanceExportInput,
	type EventAttendanceLookupInput,
	type EventAttendanceLookupResult,
	type EventAttendanceSnapshot,
} from "@/effect/services/attendanceExport/types";
import { CCBService } from "@/effect/services/CCBService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { ExportStorageService } from "@/effect/services/ExportStorageService";
import { Context, Effect, Layer } from "effect";

export type { AttendanceExportFormat } from "@/effect/services/attendanceExport/types";

interface AttendanceExportServiceContract {
	exportEventAttendancePdf: (
		input: EventAttendanceExportInput[],
		format?: AttendanceExportFormat,
	) => Effect.Effect<AttendancePdfExportResult, AttendancePdfExportError>;
	exportEventAttendeesPdf: (
		params: Pick<EventAttendanceLookupInput, "ccbGroupId" | "eventId" | "occurrenceDate">,
		format?: AttendanceExportFormat,
	) => Effect.Effect<AttendancePdfExportResult, AttendancePdfExportError>;
	getEventAttendanceByCcb: (
		input: EventAttendanceLookupInput[],
	) => Effect.Effect<EventAttendanceLookupResult[], AttendancePdfExportError>;
	getEventAttendeesSnapshot: (
		params: Pick<EventAttendanceLookupInput, "ccbGroupId" | "eventId" | "occurrenceDate">,
	) => Effect.Effect<EventAttendanceSnapshot, AttendancePdfExportError>;
}

const warnDbFailure = (operation: string, cause: unknown, meta?: Record<string, string>) =>
	// Continue with upstream CCB data when the Postgres cache path is unavailable.
	Effect.logWarning(
		`${operation} failed; continuing without Postgres-backed cache for this request`,
	).pipe(
		Effect.annotateLogs({
			...meta,
			error: String(cause),
		}),
		Effect.asVoid,
	);

/**
 * AttendanceExportService - Coordinates attendance snapshots and PDF export flows.
 */
export class AttendanceExportService extends Context.Service<
	AttendanceExportService,
	AttendanceExportServiceContract
>()("AttendanceExportService", {
	make: Effect.gen(function* () {
		const scope = yield* Effect.scope;
		const ccb = yield* CCBService;
		const exportStorage = yield* ExportStorageService;
		const lru = yield* LRUService;
		const redis = yield* RedisService;
		const drizzle = yield* DrizzleService;

		const snapshotApi = createAttendanceSnapshotApi({
			scope,
			ccb,
			drizzle,
			lru,
			redis,
			warnDbFailure,
		});

		const exportApi = createAttendanceExportApi({
			drizzle,
			getEventAttendeesSnapshot: snapshotApi.getEventAttendeesSnapshot,
			warnDbFailure,
		});
		const provideExportStorage = <A, E>(make: Effect.Effect<A, E, ExportStorageService>) =>
			Effect.provideService(make, ExportStorageService, exportStorage);

		// Keep this service as the single wiring point.
		const api: AttendanceExportServiceContract = {
			exportEventAttendancePdf: (input, format) =>
				provideExportStorage(exportApi.exportEventAttendancePdf(input, format)),
			exportEventAttendeesPdf: (params, format) =>
				provideExportStorage(exportApi.exportEventAttendeesPdf(params, format)),
			getEventAttendanceByCcb: snapshotApi.getEventAttendanceByCcb,
			getEventAttendeesSnapshot: snapshotApi.getEventAttendeesSnapshot,
		};

		return api;
	}),
}) {}

export const AttendanceExportServiceLive = Layer.effect(
	AttendanceExportService,
	AttendanceExportService.make,
);
