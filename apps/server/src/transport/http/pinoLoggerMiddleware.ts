import { formatOperationName } from "@/graphql/known-operation-names";
/**
 * Basically the hono built-in logger middleware but it's pino and has the
 * ability to thread context through child logger calls.
 * https://github.com/honojs/hono/blob/main/src/middleware/logger/index.ts#L1
 */
import {
	getClientTelemetryMetadata,
	getCorrelationContext,
	recordRequestTelemetry,
	sanitizeTelemetryData,
} from "@/platform/observability";
// The leaf module, not the index: the logger builds its redaction list at load time.
import { SECRET_REQUEST_HEADERS } from "@/platform/observability/redaction";
import { omitUndefined } from "@/utils/omitUndefined";
import { routePath } from "hono/route";
import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";

import type { Context, MiddlewareHandler } from "hono";

/** Fields removed from every log line. Secret headers go both under req.headers and top level. */
const logRedaction = {
	paths: [
		"req.headers.authorization",
		"authorization",
		...SECRET_REQUEST_HEADERS.flatMap((name) => [`req.headers["${name}"]`, `["${name}"]`]),
		"token",
		"password",
		"cookie",
		"apiKey",
		"email",
	],
	remove: true,
};

export const logOptions: pino.LoggerOptions = {
	// The host stamps each stdout line, and request logs use `time` for their duration.
	timestamp: false,
	// Railway reads `level` as a name; Pino's numeric default leaves every line at info.
	formatters: { level: (label) => ({ level: label }) },
	redact: logRedaction,
};

const rootLogger = pino(logOptions);

const HEALTH_PROBE_PATHS: ReadonlySet<string> = new Set(["/", "/healthz", "/readyz"]);

// App-wide middleware patterns. When one of these was the last route to run, no route matched.
const MIDDLEWARE_ROUTE_PATTERNS: ReadonlySet<string> = new Set(["*", "/*"]);

/** The pattern of the route that answered (`/graphql`, `/v1/*`), read after the chain ran. */
function answeringRoute(c: Context): string | undefined {
	const route = routePath(c);
	return MIDDLEWARE_ROUTE_PATTERNS.has(route) ? undefined : route;
}
const loggerProvider = new AsyncLocalStorage<pino.Logger>();

export function getLogger() {
	const logger = loggerProvider.getStore();
	if (!logger) {
		return rootLogger;
	}
	return logger;
}

/**
 * Stores GraphQL operation context for the current request.
 * Set by useGraphQLLogger plugin, read by pino middleware.
 */
interface GraphQLOperationInfo {
	operationName: string | null;
	operationType: "query" | "mutation" | "subscription" | null;
	fields: string[];
	/** GraphQL errors in the response; HTTP 200 responses can still carry them. */
	errorCount?: number;
}

const graphqlOperationStore = new AsyncLocalStorage<GraphQLOperationInfo>();

function getGraphQLOperationInfo(): GraphQLOperationInfo | undefined {
	return graphqlOperationStore.getStore();
}

export function getGraphQLOperationLogContext() {
	const info = getGraphQLOperationInfo();
	if (!info) {
		return;
	}

	return {
		operationName: formatOperationName(info.operationName),
		operationType: info.operationType,
		fields: info.fields,
	};
}

export function setGraphQLOperationInfo(info: GraphQLOperationInfo) {
	const store = graphqlOperationStore.getStore();
	if (store) {
		store.operationName = info.operationName;
		store.operationType = info.operationType;
		store.fields = info.fields;
	}
}

export function setGraphQLErrorCount(errorCount: number) {
	const store = graphqlOperationStore.getStore();
	if (store) {
		store.errorCount = errorCount;
	}
}

export const pinoLogger = (baseLogger: pino.Logger = rootLogger): MiddlewareHandler =>
	async function logger(c, next) {
		const context = {
			requestId: c.var.requestId,
			userAgent: c.req.header("user-agent"),
		};

		const requestLogger = baseLogger.child(context);

		const graphqlInfo: GraphQLOperationInfo = {
			// oxlint-disable-next-line no-null
			operationName: null,
			// oxlint-disable-next-line no-null
			operationType: null,
			fields: [],
		};

		return await loggerProvider.run(
			requestLogger,
			async () =>
				await graphqlOperationStore.run(graphqlInfo, async () => {
					// Query strings can carry bearer credentials, including attendance download tokens.
					const { method, path } = c.req;

					const start = performance.now();

					await next();

					const end = performance.now();

					if (c.error) {
						requestLogger.error(c.error);
					}

					const gqlInfo = getGraphQLOperationInfo();
					const correlation = getCorrelationContext(c.req.raw.headers, c.var.requestId);
					const client = getClientTelemetryMetadata(c.req.raw.headers);
					const logData = {
						method,
						path,
						status: c.res.status,
						time: end - start,
						client: { ...client },
						operationName: formatOperationName(gqlInfo?.operationName),
						operationType: gqlInfo?.operationType,
						fields: gqlInfo?.fields,
						errorCount: gqlInfo?.errorCount,
						traceId: correlation.traceId,
						spanId: correlation.spanId,
					};

					recordRequestTelemetry(
						omitUndefined({
							method,
							route: answeringRoute(c),
							status: c.res.status,
							durationMs: end - start,
							correlation,
							client,
							graphql:
								path === "/graphql"
									? {
											operationName: formatOperationName(gqlInfo?.operationName),
											operationType: gqlInfo?.operationType ?? "unknown",
										}
									: undefined,
						}),
					);

					// Uptime and readiness checks hit these about once a minute; only failures are news.
					const isPassingProbe =
						method === "GET" && HEALTH_PROBE_PATHS.has(path) && c.res.status < 400;
					if (isPassingProbe) {
						requestLogger.debug(sanitizeTelemetryData(logData));
					} else {
						requestLogger.info(sanitizeTelemetryData(logData));
					}
				}),
		);
	};
