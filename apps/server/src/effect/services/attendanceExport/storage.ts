import { EXPORT_BUCKET } from "@/effect/services/attendanceExport/constants";
import {
	AttendancePdfExportError,
	type AttendanceExportFormat,
} from "@/effect/services/attendanceExport/types";
import { ExportStorageService } from "@/effect/services/ExportStorageService";
import { getTabularExportContentType } from "@/utils/tabularExport";
import { Effect } from "effect";

export const uploadExportFile = (
	objectPath: string,
	data: Buffer,
	format: AttendanceExportFormat,
) =>
	Effect.gen(function* () {
		const storage = yield* ExportStorageService;
		yield* storage.uploadPrivateFile({
			bucketName: EXPORT_BUCKET,
			contentType: getTabularExportContentType(format),
			data,
			objectPath,
		});
	}).pipe(
		Effect.mapError(
			(error) =>
				new AttendancePdfExportError({
					cause: error,
					message: "Failed to upload attendance export file to Google Cloud Storage",
				}),
		),
	);

export const downloadExportFile = (bucketName: string, objectPath: string) =>
	Effect.gen(function* () {
		const storage = yield* ExportStorageService;
		return yield* storage.downloadFile(bucketName, objectPath);
	}).pipe(
		Effect.mapError(
			(error) =>
				new AttendancePdfExportError({
					cause: error,
					message: "Failed to download attendance export file from Google Cloud Storage",
				}),
		),
	);

export const doesExportFileExist = (bucketName: string, objectPath: string) =>
	Effect.gen(function* () {
		const storage = yield* ExportStorageService;
		return yield* storage.doesFileExist(bucketName, objectPath);
	}).pipe(
		Effect.mapError(
			(error) =>
				new AttendancePdfExportError({
					cause: error,
					message: "Failed to verify attendance export file existence in Google Cloud Storage",
				}),
		),
	);
