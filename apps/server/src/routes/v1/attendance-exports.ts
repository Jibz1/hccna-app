import { RequestContext } from "@/effect/RequestContext";
import { getAttendanceExportRow } from "@/effect/services/attendanceExport/repositories";
import { toHash } from "@/effect/services/attendanceExport/shared";
import { downloadExportFile } from "@/effect/services/attendanceExport/storage";
import { V1Api } from "@/routes/v1/api";
import { ExportKeySchema, type ExportKey } from "@/types/ids";
import { getTabularExportContentType } from "@/utils/tabularExport";
import { timingSafeEqual } from "crypto";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { basename } from "path";

import type { AppRuntimeContext } from "@/effect/requestExecution";

const tokenMatchesHash = (token: string, expectedTokenHash: string | null | undefined) => {
	if (!expectedTokenHash) {
		return false;
	}

	const actual = Buffer.from(toHash(token), "utf8");
	const expected = Buffer.from(expectedTokenHash, "utf8");

	return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const getExportContentType = (objectPath: string) =>
	objectPath.endsWith(".csv")
		? getTabularExportContentType("CSV")
		: getTabularExportContentType("PDF");

/** Structural view of the export row fields the download handler reads. */
interface AttendanceExportRowLike {
	readonly downloadTokenHash: string | null;
	readonly gcsBucket: string;
	readonly gcsObjectPath: string;
}

export interface AttendanceExportRouteDeps<R> {
	// Test injection hooks should preserve the production Effect requirements.
	readonly getExportRow: (
		exportKey: ExportKey,
	) => Effect.Effect<AttendanceExportRowLike | null, unknown, R>;
	readonly downloadFile: (
		bucketName: string,
		objectPath: string,
	) => Effect.Effect<Buffer, unknown, R>;
}

export const makeAttendanceExportsGroupLive = <R>(deps: AttendanceExportRouteDeps<R>) =>
	HttpApiBuilder.group(V1Api, "attendanceExports", (handlers) =>
		handlers.handleRaw("attendanceExport", ({ params, query }) => {
			const exportKey = ExportKeySchema.make(params.exportKey);
			// Duplicated ?token= keys decode to an array; use the first occurrence,
			// matching Hono's previous query semantics.
			const token = Array.isArray(query.token) ? query.token[0] : query.token;

			return Effect.gen(function* () {
				yield* RequestContext;

				const exportRow = yield* deps.getExportRow(exportKey);
				if (!exportRow) {
					return HttpServerResponse.text("Not Found", { status: 404 });
				}

				if (!token || !tokenMatchesHash(token, exportRow.downloadTokenHash)) {
					return HttpServerResponse.text("Forbidden", { status: 403 });
				}

				const data = yield* deps.downloadFile(exportRow.gcsBucket, exportRow.gcsObjectPath);
				const fileName = basename(exportRow.gcsObjectPath);

				return HttpServerResponse.uint8Array(new Uint8Array(data), {
					status: 200,
					contentType: getExportContentType(exportRow.gcsObjectPath),
					headers: {
						"cache-control": "private,max-age=300",
						"content-disposition": `attachment; filename="${fileName}"`,
						"x-content-type-options": "nosniff",
					},
				});
			}).pipe(
				Effect.catch((error) =>
					Effect.logError("Attendance export route failed").pipe(
						Effect.annotateLogs({
							error: error instanceof Error ? error.message : String(error),
							exportKey,
						}),
						Effect.as(HttpServerResponse.text("Internal Server Error", { status: 500 })),
					),
				),
			);
		}),
	);

export const AttendanceExportsGroupLive = makeAttendanceExportsGroupLive<AppRuntimeContext>({
	getExportRow: getAttendanceExportRow,
	downloadFile: downloadExportFile,
});
