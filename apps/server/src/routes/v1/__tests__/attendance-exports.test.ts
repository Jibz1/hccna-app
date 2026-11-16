import { buildRequestContextFromRequest, RequestContext } from "@/effect/RequestContext";
import { toHash } from "@/effect/services/attendanceExport/shared";
import { V1Api, V1PlatformLayer } from "@/routes/v1/api";
import {
	makeAttendanceExportsGroupLive,
	type AttendanceExportRouteDeps,
} from "@/routes/v1/attendance-exports";
import { describe, expect, it, mock } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

const getExportRowMock = mock();
const downloadFileMock = mock();

const buildHandler = () => {
	const attendanceExportsGroup = makeAttendanceExportsGroupLive({
		getExportRow: getExportRowMock,
		downloadFile: downloadFileMock,
	} as AttendanceExportRouteDeps<never>);
	const handlerLayer = HttpApiBuilder.layer(V1Api).pipe(
		Layer.provide(attendanceExportsGroup),
		Layer.provide(V1PlatformLayer),
	);

	return HttpRouter.toWebHandler(handlerLayer, { disableLogger: true });
};

const getExport = (handler: ReturnType<typeof buildHandler>["handler"], pathWithQuery: string) => {
	const request = new Request(`http://localhost${pathWithQuery}`);
	return handler(request, Context.make(RequestContext, buildRequestContextFromRequest(request)));
};

describe("attendance export download route", () => {
	it("rejects an invalid token", async () => {
		const { handler, dispose } = buildHandler();

		getExportRowMock.mockReturnValueOnce(
			Effect.succeed({
				downloadTokenHash: toHash("valid-token"),
				exportKey: "single:pdf:event-1:2026-02-15",
				gcsBucket: "app-hccnj",
				gcsObjectPath: "apps/asset/attendance/single/event-1/2026-02-15.pdf",
				publicUrl: "/v1/attendance-exports/single%3Apdf%3Aevent-1%3A2026-02-15?token=valid-token",
			}),
		);

		try {
			const response = await getExport(
				handler,
				"/v1/attendance-exports/single%3Apdf%3Aevent-1%3A2026-02-15?token=bad-token",
			);

			expect(response.status).toBe(403);
			expect(await response.text()).toBe("Forbidden");
			expect(response.headers.get("content-type")).toStartWith("text/plain");
			expect(downloadFileMock).not.toHaveBeenCalled();
		} finally {
			await dispose();
		}
	});
});
