import { AppConfig } from "@/effect/AppConfig";
import { managedRuntime } from "@/effect/Runtime";
import { getGraphQLRateLimitStoreEffect } from "@/effect/services/GraphQLRateLimitStoreService";
import { getGraphQLResponseCacheEffect } from "@/effect/services/GraphQLResponseCacheService";
import { createGraphQLContext, type ServerContext } from "@/graphql/context";
import { formatOperationName } from "@/graphql/known-operation-names";
import { useKnownOperationGuard } from "@/graphql/knownOperationGuard";
import {
	DEFAULT_QUERY_COMPLEXITY_FIELD_COSTS,
	DEFAULT_QUERY_COMPLEXITY_FIELD_MAXIMUMS,
	useQueryComplexity,
} from "@/graphql/queryComplexity";
import {
	configureResponseCache,
	responseCache,
	responseCacheDefaultTtlMs,
	responseCacheTtlPerSchemaCoordinate,
} from "@/graphql/responseCache";
import {
	getGraphQLResponseCacheEnabled,
	getGraphQLResponseCacheSessionId,
	useMarkGraphQLSharedResponseCacheRequests,
} from "@/graphql/sharedResponseCachePolicy";
import { useGraphQLLogger } from "@/graphql/useGraphQLLogger";
import { useRequireOperationName } from "@/graphql/useRequireOperationName";
import { DEFAULT_DURATION_HISTOGRAM_BUCKETS } from "@/metrics/create";
import { prometheusRegistry } from "@/platform/observability/prometheusRegistry";
import { APP_TIMEOUT_MS } from "@/server/constants";
import { appCheckMiddleware } from "@/transport/http/appCheckMiddleware";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { useSentry } from "@envelop/sentry";
import { useAPQ } from "@graphql-yoga/plugin-apq";
import { useDeferStream } from "@graphql-yoga/plugin-defer-stream";
import {
	createCounter as createEnvelopCounter,
	createHistogram as createEnvelopHistogram,
	usePrometheus,
} from "@graphql-yoga/plugin-prometheus";
import { useResponseCache } from "@graphql-yoga/plugin-response-cache";
import { Effect } from "effect";
import { createYoga } from "graphql-yoga";
import { rateLimiter } from "hono-rate-limiter";
import { getConnInfo } from "hono/bun";
import { createStellateLoggerPlugin } from "stellate/graphql-yoga";

import { emitSchema } from "../graphql/emit";
import { schema } from "../graphql/schema";

import type { OpenAPIHono } from "@hono/zod-openapi";

const GRAPHQL_RATE_LIMIT_WINDOW_MS = 1000;

const getClientIp = (
	c: Parameters<NonNullable<Parameters<typeof rateLimiter>[0]["keyGenerator"]>>[0],
) => {
	const forwardedFor = c.req.header("X-Forwarded-For");
	if (forwardedFor) {
		return forwardedFor;
	}

	try {
		return getConnInfo(c).remote.address;
	} catch {
		// Some execution contexts do not expose socket metadata.
	}
};

const createGraphQLRouteResourcesEffect = Effect.gen(function* () {
	const appConfig = yield* AppConfig;
	const graphQLResponseCache = yield* getGraphQLResponseCacheEffect;
	const graphQLRateLimitStore = yield* getGraphQLRateLimitStoreEffect(GRAPHQL_RATE_LIMIT_WINDOW_MS);

	return {
		appConfig,
		responseCache: graphQLResponseCache,
		rateLimitStore: graphQLRateLimitStore,
	};
});

export async function registerGraphQLRoute(app: OpenAPIHono) {
	const {
		appConfig,
		responseCache: sharedResponseCache,
		rateLimitStore,
	} = await managedRuntime.runPromise(createGraphQLRouteResourcesEffect);

	configureResponseCache(sharedResponseCache);

	const yoga = createYoga<ServerContext>({
		schema,
		context: createGraphQLContext,
		// Yoga 6 logs every request at info; useGraphQLLogger already does, so keep Yoga to errors.
		logging: "warn",
		plugins: [
			useAPQ(),
			useRequireOperationName(),
			useKnownOperationGuard({ enforce: appConfig.graphql.requireKnownOperations }),
			useMarkGraphQLSharedResponseCacheRequests(),
			// After the cache policy, whose parsed document it reads for response-cache hits.
			useGraphQLLogger(),
			useQueryComplexity({
				schema,
				maximumComplexity: 2000,
				maximumComplexityByFieldName: DEFAULT_QUERY_COMPLEXITY_FIELD_MAXIMUMS,
				defaultFieldComplexity: 1,
				defaultListComplexity: 10,
				fieldComplexityByCoordinate: DEFAULT_QUERY_COMPLEXITY_FIELD_COSTS,
			}),
			...(appConfig.isProduction && appConfig.observability.stellateLoggerToken
				? [
						createStellateLoggerPlugin({
							fetch,
							sendVariablesAsHash: true,
							serviceName: "hccna",
							token: appConfig.observability.stellateLoggerToken,
						}),
					]
				: []),
			useDeferStream(),
			useSentry({
				forceTransaction: true,
				renameTransaction: true,
			}),
			usePrometheus({
				registry: prometheusRegistry,
				metrics: {
					graphql_envelop_request: createEnvelopCounter({
						registry: prometheusRegistry,
						counter: {
							name: "graphql_envelop_request",
							help: "Counts the amount of GraphQL requests executed through Envelop",
							labelNames: ["operationName", "operationType"],
						},
						fillLabelsFn: (params) => ({
							operationName: formatOperationName(params.operationName),
							operationType: params.operationType ?? "unknown",
						}),
					}),
					graphql_envelop_request_duration: createEnvelopHistogram({
						registry: prometheusRegistry,
						histogram: {
							name: "graphql_envelop_request_duration",
							help: "Time spent on running the GraphQL operation from parse to execute",
							buckets: DEFAULT_DURATION_HISTOGRAM_BUCKETS,
							labelNames: ["operationName", "operationType"],
						},
						fillLabelsFn: (params) => ({
							operationName: formatOperationName(params.operationName),
							operationType: params.operationType ?? "unknown",
						}),
					}),
					graphql_envelop_error_result: createEnvelopCounter({
						registry: prometheusRegistry,
						counter: {
							name: "graphql_envelop_error_result",
							help: "Counts the amount of errors reported from all phases",
							labelNames: ["operationName", "operationType", "phase", "path"],
						},
						fillLabelsFn: (params) => ({
							operationName: formatOperationName(params.operationName),
							operationType: params.operationType ?? "unknown",
							phase: params.errorPhase,
							path: params.error?.path?.join(".") ?? "",
						}),
					}),
					graphql_yoga_http_duration: false,
				},
				endpoint: false,
			}),
			// Keep response cache last; it needs to own the final execute wrapper.
			useResponseCache({
				enabled: (request, context) =>
					!appConfig.graphql.featuredEventsDirectStrapi &&
					getGraphQLResponseCacheEnabled(request, context),
				session: (request) => getGraphQLResponseCacheSessionId(request),
				cache: responseCache,
				ttl: responseCacheDefaultTtlMs,
				ttlPerSchemaCoordinate: responseCacheTtlPerSchemaCoordinate,
				scopePerSchemaCoordinate: {
					"Query.user": "PRIVATE",
					"Query.profile": "PRIVATE",
					"Query.getPreviousFiveYearsGivingV2": "PRIVATE",
					"Query.myGivingHistory": "PRIVATE",
					"Query.exportAttendance": "PRIVATE",
				},
				invalidateViaMutation: true,
				includeExtensionMetadata: !appConfig.isProduction,
			}),
		],
	});

	// Rate limiting for GraphQL endpoint
	app.use(
		"/graphql",
		rateLimiter({
			limit: appConfig.graphql.rateLimitRps,
			windowMs: GRAPHQL_RATE_LIMIT_WINDOW_MS,
			standardHeaders: "draft-7",
			store: rateLimitStore,
			message: {
				errors: [
					{
						message: "Too many requests, please try again later.",
						extensions: {
							code: "TOO_MANY_REQUESTS",
						},
					},
				],
			},
			keyGenerator: (c) => getClientIp(c) || "unknown",
		}),
	);
	app.use("/graphql", appCheckMiddleware());

	// GraphQL endpoint
	app.on(["POST", "GET"], "/graphql", (c) => {
		const requestWithAbort = new Request(c.req.raw, {
			signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(APP_TIMEOUT_MS)]),
		});
		const clientIp = getClientIp(c);

		return yoga.handle(requestWithAbort, {
			clientIp,
			requestId: c.var.requestId,
			response: c.res,
		});
	});

	if (!appConfig.isProduction) {
		try {
			const path = emitSchema();
			getLogger().info({ path }, "GraphQL schema written");
		} catch (error) {
			getLogger().warn(
				{ err: error, path: "packages/schema/schema.graphql" },
				"Could not write GraphQL schema file",
			);
		}
	}
}
