import { OperationalReadinessService } from "@/effect/services/OperationalReadinessService";
import { printMetrics, registerMetrics } from "@/platform/observability/prometheusRegistry";
import { APP_TIMEOUT_MS } from "@/server/constants";
import { effectMetricReader } from "@/telemetry";
import { runHonoEffect } from "@/transport/http/honoEffectRunner";
import {
	getGraphQLOperationLogContext,
	getLogger,
	pinoLogger,
} from "@/transport/http/pinoLoggerMiddleware";
import { OpenAPIHono } from "@hono/zod-openapi";
import { PrometheusSerializer } from "@opentelemetry/exporter-prometheus";
import * as Sentry from "@sentry/bun";
import { Predicate } from "effect";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { timeout } from "hono/timeout";

import type { AppConfigContract } from "@/effect/AppConfig";

export const metricsApp = new Hono();
const logger = getLogger();

function sanitizeReadinessFailures(
	failures: readonly { dependency: string }[],
): readonly { dependency: string; status: "unavailable" }[] {
	return failures.map(({ dependency }) => ({
		dependency,
		status: "unavailable",
	}));
}

const prometheusSerializer = new PrometheusSerializer();
metricsApp.get("/metrics", async (c) => {
	// Expose custom and OTEL metrics from one scrape endpoint.
	const [customMetrics, effectMetrics] = await Promise.all([
		printMetrics(c).then((r) => r.text()),
		effectMetricReader
			.collect()
			.then((collected) => prometheusSerializer.serialize(collected.resourceMetrics)),
	]);

	return c.text(`${customMetrics}\n${effectMetrics}`);
});

export async function createApp(appConfig: AppConfigContract) {
	const app = new OpenAPIHono();
	const { registerGraphQLRoutes, registerVersionedRoutes } = await import("@/routes");
	const { mergeV1OpenApiDocument } = await import("@/routes/v1/api");

	app.onError((err, c) => {
		const safePath = c.req.path.replaceAll(/[\r\n]/gu, "");
		const isGraphQLRequest = c.req.path === "/graphql" || c.req.path.startsWith("/graphql/");

		if (isGraphQLRequest) {
			// Keep transport-level GraphQL failures in spec-shaped JSON.
			const statusCode =
				Predicate.hasProperty(err, "status") && Predicate.isNumber(err.status) ? err.status : 500;
			const message = statusCode >= 500 ? "Internal Server Error" : err.message || "Request failed";

			if (statusCode >= 500) {
				const graphqlContext = getGraphQLOperationLogContext();
				Sentry.captureException(err);
				logger.error(
					{
						err,
						...graphqlContext,
						path: safePath,
						statusCode,
					},
					"GraphQL transport error",
				);
			}

			// Keep explicit JSON response formatting here.
			return new Response(
				// oxlint-disable-next-line
				JSON.stringify({
					errors: [
						{
							message,
							extensions: {
								code: statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST",
							},
						},
					],
				}),
				{
					status: statusCode,
					headers: {
						"Content-Type": "application/json",
					},
				},
			);
		}

		if ("getResponse" in err) {
			return err.getResponse();
		}
		Sentry.captureException(err);
		logger.error({ err, path: safePath }, "Unhandled HTTP error");
		return c.text("Internal Server Error", 500);
	});

	app.use("*", registerMetrics);
	app.use("*", compress());
	app.use("*", requestId());
	app.use(pinoLogger());
	app.use(timeout(APP_TIMEOUT_MS));

	if (!appConfig.isProduction) {
		app.use(prettyJSON());
	}

	app.use(cors());

	await registerGraphQLRoutes(app);

	if (appConfig.showApiReference) {
		const { Scalar } = await import("@scalar/hono-api-reference");

		app.get(
			"/reference",
			Scalar({
				url: "/openapi.json",
				theme: "purple",
				title: "HCCNA Backend API",
			}),
		);
	}

	// Combine the Hono-generated document with the HttpApi-generated v1 paths
	// so /openapi.json keeps serving a single spec covering both transports.
	app.get("/openapi.json", (c) =>
		c.json(
			mergeV1OpenApiDocument(
				app.getOpenAPIDocument({
					openapi: "3.0.0",
					info: {
						version: "1.0.0",
						title: "HCCNA Backend API",
					},
				}),
			),
		),
	);

	app.get("/", (c) => c.json({ ok: true }));

	app.get("/healthz", (c) => c.text("OK"));

	app.get("/readyz", async (c) => {
		try {
			const failures = await runHonoEffect(
				c,
				OperationalReadinessService.use((service) => service.check),
			);

			if (failures.length > 0) {
				logger.warn({ failures }, "Readiness check failed");
				return c.json({ ok: false, failures: sanitizeReadinessFailures(failures) }, 503);
			}

			return c.text("OK");
		} catch (error) {
			logger.error({ err: error }, "Readiness check crashed");
			return c.json(
				{
					ok: false,
					failures: sanitizeReadinessFailures([
						{
							dependency: "runtime",
						},
					]),
				},
				503,
			);
		}
	});

	registerVersionedRoutes(app);

	return app;
}
