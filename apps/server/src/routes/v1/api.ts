import { getTabularExportContentType } from "@/utils/tabularExport";
import { FileSystem, Layer, Path, Schema } from "effect";
import { Etag, HttpPlatform } from "effect/http";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import type { OpenAPIHono } from "@hono/zod-openapi";

// Wire-contract note: runtime request/response bytes are produced by the raw
// handler in attendance-exports.ts. The schemas below exist to keep
// /openapi.json documenting the same shapes the legacy zod-openapi
// definitions advertised.

const textResponse = (status: number) =>
	Schema.String.pipe(HttpApiSchema.asText(), HttpApiSchema.status(status));

const tokenQueryValueSchema = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const tokenQuerySchema = Schema.optional(tokenQueryValueSchema);
const csvContentType = getTabularExportContentType("CSV");
const pdfContentType = getTabularExportContentType("PDF");
const csvResponseSchema = Schema.String.pipe(HttpApiSchema.asText({ contentType: csvContentType }));
const pdfResponseSchema = Schema.String.pipe(HttpApiSchema.asText({ contentType: pdfContentType }));

const attendanceExportsGroup = HttpApiGroup.make("attendanceExports").add(
	HttpApiEndpoint.get("attendanceExport", "/v1/attendance-exports/:exportKey", {
		params: { exportKey: Schema.String },
		// Repeated query keys parse to string arrays; tolerate them here (a decode
		// failure would die before the handler runs) and collapse to the first
		// value in the handler, matching the previous Hono behavior.
		query: { token: tokenQuerySchema },
		success: [csvResponseSchema, pdfResponseSchema],
		error: [textResponse(403), textResponse(404), textResponse(500)],
	}),
);

export const V1Api = HttpApi.make("v1").add(attendanceExportsGroup);

const FileSystemNoopLayer = FileSystem.layerNoop({});

// Platform services HttpApiBuilder.layer needs to serve the api. No v1 route
// serves files from disk, so the noop FileSystem is sufficient.
export const V1PlatformLayer = Layer.mergeAll(
	Etag.layer,
	Path.layer,
	FileSystemNoopLayer,
	HttpPlatform.layer.pipe(Layer.provide(FileSystemNoopLayer)),
);

type HonoOpenApiDocument = ReturnType<OpenAPIHono["getOpenAPIDocument"]>;

/**
 * Merges the HttpApi-generated v1 paths into the Hono-generated OpenAPI
 * document so /openapi.json keeps serving one combined spec, as it did when
 * the v1 routes were registered on OpenAPIHono directly.
 */
export function mergeV1OpenApiDocument(baseDocument: HonoOpenApiDocument) {
	const v1Spec = OpenApi.fromApi(V1Api);

	return {
		...baseDocument,
		paths: { ...baseDocument.paths, ...v1Spec.paths },
		components: {
			...baseDocument.components,
			schemas: {
				...baseDocument.components?.schemas,
				...v1Spec.components.schemas,
			},
			securitySchemes: {
				...baseDocument.components?.securitySchemes,
				...v1Spec.components.securitySchemes,
			},
		},
		tags: [...(baseDocument.tags ?? []), ...v1Spec.tags],
	};
}
