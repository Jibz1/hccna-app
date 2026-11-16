import { Config, ConfigProvider, Context, Effect, Layer, Option, Predicate, Schema } from "effect";

const DEFAULT_SERVER_PORT = 8080;
const DEFAULT_METRICS_PORT = 9184;
// Per-client-IP limit over a 1s window. The mobile app fires ~8-10 parallel
// queries on launch, and error retries can double that, so the floor must
// clear a full launch burst (3 rps caused user-facing 429s during the
// 2026-07-17 Castr outage).
const DEFAULT_GRAPHQL_RATE_LIMIT_RPS = 20;
const DEFAULT_LRU_CACHE_MAX = 1000;
const DEFAULT_LRU_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LOCAL_REDIS_URL = "redis://localhost:6379";
const DEFAULT_OTEL_SERVICE_NAME = "hccna-backend";
const DEFAULT_STELLATE_SERVICE_NAME = "hccna";
const DEFAULT_SENTRY_SAMPLE_RATE = 0.8;
// Traces sample independently of errors: every sampled request builds a
// Sentry transaction, so this stays low while error capture stays high.
const DEFAULT_SENTRY_TRACES_SAMPLE_RATE = 0.1;
const DEFAULT_SLOW_REQUEST_MS = 2000;
const SUPPORTED_NODE_ENVS = ["development", "production", "staging", "test"] as const;
const SUPPORTED_STREAM_EDIT_POLICIES = ["filter", "reject"] as const;
const SUPPORTED_APP_CHECK_ENFORCEMENT_MODES = ["off", "monitor", "enforce"] as const;

type NodeEnv = (typeof SUPPORTED_NODE_ENVS)[number];
export type StreamEditUnauthorizedPlatformPolicy = (typeof SUPPORTED_STREAM_EDIT_POLICIES)[number];
type AppCheckEnforcementMode = (typeof SUPPORTED_APP_CHECK_ENFORCEMENT_MODES)[number];

interface AppConfigSource {
	readonly nodeEnv: string;
	readonly port: string;
	readonly metricsPort: string;
	readonly graphqlRateLimitRps: string;
	readonly graphqlRequireKnownOperations: string;
	readonly featuredEventsDirectStrapi: string;
	readonly backgroundWorkersEnabled: string;
	readonly streamEditUnauthorizedPlatformPolicy: string;
	readonly redisHost: string | undefined;
	readonly redisPort: string | undefined;
	readonly redisUsername: string | undefined;
	readonly redisPassword: string | undefined;
	readonly lruCacheMax: string;
	readonly lruCacheTtlMs: string;
	readonly dbPoolMax: string;
	readonly dbConnectionTimeoutMs: string;
	readonly dbIdleTimeoutMs: string;
	readonly databaseUrl: string | undefined;
	readonly dbStatementTimeoutMs: string;
	readonly slowQueryThresholdMs: string;
	readonly vodTimezone: string;
	readonly sentryDsn: string | undefined;
	readonly sentryEnabled: string;
	readonly sentrySampleRate: string;
	readonly sentryTracesSampleRate: string;
	readonly stellateLoggerToken: string | undefined;
	readonly stellatePurgeToken: string | undefined;
	readonly stellateServiceName: string;
	readonly otelSamplingRatio: string;
	readonly otelExporterOtlpHeaders: string | undefined;
	readonly otelExporterOtlpTracesEndpoint: string | undefined;
	readonly otelExporterOtlpEndpoint: string | undefined;
	readonly otelServiceName: string;
	readonly otelProdSampleRate: string;
	readonly otelStagingSampleRate: string;
	readonly otelDevSampleRate: string;
	readonly observabilitySlowRequestMs: string;
	readonly serviceRevisionName: string | undefined;
	readonly projectId: string | undefined;
	readonly railwayDeploymentId: string | undefined;
	readonly railwayReplicaId: string | undefined;
	readonly railwayReplicaRegion: string | undefined;
	readonly sendgridApiKey: string | undefined;
	readonly gcsExportBucket: string | undefined;
	readonly statsigServerSecretKey: string | undefined;
	readonly statsigEnvironment: string | undefined;
	readonly statsigClientSdkKey: string | undefined;
	readonly cloudRunServiceUrl: string | undefined;
	readonly googleInternalAllowedEmails: string | undefined;
	readonly appCheckEnforcement: string;
	readonly appCheckAllowedAppIds: string | undefined;
	readonly enabledIntegrationPlugins: string | undefined;
	readonly pluginContractVersionExpected: string;
}

// Railway sets these on every deployment; their presence means we run on Railway.
interface RailwayDeployment {
	readonly deploymentId: string;
	readonly replicaId: string | undefined;
	readonly region: string | undefined;
}

export interface AppConfigContract {
	readonly nodeEnv: string;
	readonly isProduction: boolean;
	readonly isDevelopment: boolean;
	readonly showApiReference: boolean;
	readonly server: {
		readonly port: number;
		readonly hostname: string;
		readonly development: boolean;
	};
	readonly metrics: {
		readonly port: number;
	};
	readonly graphql: {
		readonly rateLimitRps: number;
		/**
		 * Persisted-operations preparation: when true, reject operations whose
		 * name is not in the known-operation allowlist. Default false (log-only)
		 * until mobile clients ship a build-time operation manifest.
		 */
		readonly requireKnownOperations: boolean;
		readonly featuredEventsDirectStrapi: boolean;
	};
	readonly backgroundWorkers: {
		/**
		 * Onboarding queue consumer and featured-event CMS polling. A standby
		 * deployment turns these off so it never writes the shared Firestore or
		 * competes with production for queued jobs.
		 */
		readonly enabled: boolean;
	};
	readonly streamEdit: {
		/**
		 * Phase B change B1 switch (docs/streaming-migration-implementation-v3.md):
		 * "filter" preserves today's silent narrowing of unauthorized platforms;
		 * "reject" fails the whole edit command when any requested platform is
		 * outside the grant. Reverting B1 is a config change, not a deploy.
		 */
		readonly unauthorizedPlatformPolicy: StreamEditUnauthorizedPlatformPolicy;
	};
	readonly redis: {
		readonly connectionUrl: string;
	};
	readonly lru: {
		readonly max: number;
		readonly ttlMs: number;
	};
	readonly database: {
		readonly poolMax: number;
		readonly connectionTimeoutMs: number;
		readonly idleTimeoutMs: number;
		readonly connectionString: string | undefined;
		readonly statementTimeoutMs: number;
		readonly slowQueryThresholdMs: number;
	};
	readonly vod: {
		readonly timezone: string;
	};
	readonly observability: {
		readonly sentryDsn: string | undefined;
		readonly sentryEnabled: boolean;
		readonly sentrySampleRate: number;
		readonly sentryTracesSampleRate: number;
		readonly stellateLoggerToken: string | undefined;
		readonly stellatePurgeToken: string | undefined;
		readonly stellateServiceName: string;
		readonly otelSamplingRatio: number;
		readonly otelExporterOtlpHeaders: string | undefined;
		readonly otelExporterOtlpTracesEndpoint: string | undefined;
		readonly otelExporterOtlpEndpoint: string | undefined;
		readonly otelServiceName: string;
		readonly otelSampleRates: {
			readonly production: number;
			readonly staging: number;
			readonly development: number;
		};
		readonly slowRequestMs: number;
		readonly serviceRevisionName: string | undefined;
		readonly projectId: string | undefined;
		readonly railway: RailwayDeployment | undefined;
	};
	readonly integrations: {
		readonly sendgridApiKey: string | undefined;
		readonly gcsExportBucket: string | undefined;
	};
	readonly statsig: {
		readonly enabled: boolean;
		readonly serverSecretKey: string | undefined;
		readonly environment: string | undefined;
		readonly bootstrapClientSdkKey: string | undefined;
	};
	readonly auth: {
		readonly cloudRunServiceUrl: string | undefined;
		readonly googleInternalAllowedEmails: readonly string[];
	};
	readonly appCheck: {
		readonly enforcement: AppCheckEnforcementMode;
		readonly allowedAppIds: readonly string[];
	};
	readonly plugins: {
		readonly enabledPluginIds: "all" | string[];
		readonly expectedContractVersion: string;
	};
}

class AppConfigError extends Schema.TaggedError<AppConfigError>()("AppConfigError", {
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		const cause = this.cause instanceof Error ? `: ${this.cause.message}` : "";
		return `AppConfig: ${this.detail}${cause}`;
	}
}

const optionalStringConfig = (name: string) =>
	Config.String(name).pipe(
		Config.option,
		Config.map((value) => Option.getOrUndefined(value)),
	);

const stringConfigWithDefault = (name: string, fallback: string) =>
	Config.String(name).pipe(Config.withDefault(fallback));

// Read raw env strings first, then normalize them into the public config shape.
const appConfigSource = Config.all({
	nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("development")),
	port: stringConfigWithDefault("PORT", String(DEFAULT_SERVER_PORT)),
	metricsPort: stringConfigWithDefault("METRICS_SERVER_PORT", String(DEFAULT_METRICS_PORT)),
	graphqlRateLimitRps: stringConfigWithDefault(
		"GRAPHQL_RATE_LIMIT_RPS",
		String(DEFAULT_GRAPHQL_RATE_LIMIT_RPS),
	),
	graphqlRequireKnownOperations: stringConfigWithDefault(
		"GRAPHQL_REQUIRE_KNOWN_OPERATIONS",
		"false",
	),
	featuredEventsDirectStrapi: stringConfigWithDefault("FEATURED_EVENTS_DIRECT_STRAPI", "false"),
	backgroundWorkersEnabled: stringConfigWithDefault("BACKGROUND_WORKERS_ENABLED", "true"),
	streamEditUnauthorizedPlatformPolicy: Config.String(
		"STREAM_EDIT_UNAUTHORIZED_PLATFORM_POLICY",
	).pipe(Config.withDefault("filter")),
	redisHost: optionalStringConfig("REDIS_HOST"),
	redisPort: optionalStringConfig("REDIS_PORT"),
	redisUsername: optionalStringConfig("REDIS_USERNAME"),
	redisPassword: optionalStringConfig("REDIS_PASSWORD"),
	lruCacheMax: stringConfigWithDefault("LRU_CACHE_MAX", String(DEFAULT_LRU_CACHE_MAX)),
	lruCacheTtlMs: stringConfigWithDefault("LRU_CACHE_TTL_MS", String(DEFAULT_LRU_CACHE_TTL_MS)),
	dbPoolMax: Config.String("DB_POOL_MAX").pipe(Config.withDefault("50")),
	dbConnectionTimeoutMs: Config.String("DB_CONNECTION_TIMEOUT_MS").pipe(Config.withDefault("5000")),
	dbIdleTimeoutMs: Config.String("DB_IDLE_TIMEOUT_MS").pipe(Config.withDefault("30000")),
	databaseUrl: optionalStringConfig("DATABASE_URL"),
	dbStatementTimeoutMs: Config.String("DB_STATEMENT_TIMEOUT_MS").pipe(Config.withDefault("10000")),
	slowQueryThresholdMs: Config.String("SLOW_QUERY_THRESHOLD_MS").pipe(Config.withDefault("500")),
	vodTimezone: Config.String("VOD_TIMEZONE").pipe(Config.withDefault("America/New_York")),
	sentryDsn: optionalStringConfig("SENTRY_DSN"),
	sentryEnabled: Config.String("SENTRY_ENABLED").pipe(Config.withDefault("false")),
	sentrySampleRate: stringConfigWithDefault(
		"SENTRY_SAMPLE_RATE",
		String(DEFAULT_SENTRY_SAMPLE_RATE),
	),
	sentryTracesSampleRate: stringConfigWithDefault(
		"SENTRY_TRACES_SAMPLE_RATE",
		String(DEFAULT_SENTRY_TRACES_SAMPLE_RATE),
	),
	stellateLoggerToken: optionalStringConfig("STELLATE_LOGGER_TOKEN"),
	stellatePurgeToken: optionalStringConfig("STELLATE_PURGE_TOKEN"),
	stellateServiceName: Config.String("STELLATE_SERVICE_NAME").pipe(
		Config.withDefault(DEFAULT_STELLATE_SERVICE_NAME),
	),
	otelSamplingRatio: Config.String("OTEL_SAMPLING_RATIO").pipe(Config.withDefault("1")),
	otelExporterOtlpHeaders: optionalStringConfig("OTEL_EXPORTER_OTLP_HEADERS"),
	otelExporterOtlpTracesEndpoint: optionalStringConfig("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"),
	otelExporterOtlpEndpoint: optionalStringConfig("OTEL_EXPORTER_OTLP_ENDPOINT"),
	otelServiceName: Config.String("OTEL_SERVICE_NAME").pipe(
		Config.withDefault(DEFAULT_OTEL_SERVICE_NAME),
	),
	otelProdSampleRate: Config.String("OTEL_PROD_SAMPLE_RATE").pipe(Config.withDefault("0.05")),
	otelStagingSampleRate: Config.String("OTEL_STAGING_SAMPLE_RATE").pipe(Config.withDefault("0.25")),
	otelDevSampleRate: Config.String("OTEL_DEV_SAMPLE_RATE").pipe(Config.withDefault("1")),
	observabilitySlowRequestMs: stringConfigWithDefault(
		"OBSERVABILITY_SLOW_REQUEST_MS",
		String(DEFAULT_SLOW_REQUEST_MS),
	),
	serviceRevisionName: optionalStringConfig("SERVICE_REVISION_NAME"),
	projectId: optionalStringConfig("GOOGLE_CLOUD_PROJECT"),
	railwayDeploymentId: optionalStringConfig("RAILWAY_DEPLOYMENT_ID"),
	railwayReplicaId: optionalStringConfig("RAILWAY_REPLICA_ID"),
	railwayReplicaRegion: optionalStringConfig("RAILWAY_REPLICA_REGION"),
	sendgridApiKey: optionalStringConfig("SENDGRID_API_KEY2"),
	gcsExportBucket: optionalStringConfig("GCS_EXPORT_BUCKET"),
	statsigServerSecretKey: optionalStringConfig("STATSIG_SERVER_SECRET_KEY"),
	statsigEnvironment: optionalStringConfig("STATSIG_ENVIRONMENT"),
	statsigClientSdkKey: optionalStringConfig("STATSIG_CLIENT_SDK_KEY"),
	cloudRunServiceUrl: optionalStringConfig("CLOUD_RUN_SERVICE_URL"),
	googleInternalAllowedEmails: optionalStringConfig("GOOGLE_INTERNAL_ALLOWED_EMAILS"),
	appCheckEnforcement: Config.String("APP_CHECK_ENFORCEMENT").pipe(Config.withDefault("off")),
	appCheckAllowedAppIds: optionalStringConfig("APP_CHECK_ALLOWED_APP_IDS"),
	enabledIntegrationPlugins: optionalStringConfig("ENABLED_INTEGRATION_PLUGINS"),
	pluginContractVersionExpected: Config.String("PLUGIN_CONTRACT_VERSION_EXPECTED").pipe(
		Config.withDefault("1.0.0"),
	),
}) satisfies Config.Config<AppConfigSource>;

function parsePositiveInteger(label: string, value: string): number {
	const normalized = value.trim();
	if (!/^[1-9]\d*$/u.test(normalized)) {
		throw new Error(`${label} must be a positive integer`);
	}
	return Number(normalized);
}

function parseNonNegativeInteger(label: string, value: string): number {
	const normalized = value.trim();
	if (!/^\d+$/u.test(normalized)) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return Number(normalized);
}

function normalizeNodeEnv(value: string): NodeEnv {
	const normalized = value.trim().toLowerCase();

	switch (normalized) {
		case "development":
		case "production":
		case "staging":
		case "test": {
			return normalized;
		}
		default: {
			throw new Error(`NODE_ENV must be one of ${SUPPORTED_NODE_ENVS.join(", ")}`);
		}
	}
}

function normalizeAppCheckEnforcementMode(value: string): AppCheckEnforcementMode {
	const normalized = value.trim().toLowerCase();

	if (SUPPORTED_APP_CHECK_ENFORCEMENT_MODES.includes(normalized as AppCheckEnforcementMode)) {
		return normalized as AppCheckEnforcementMode;
	}

	throw new Error(
		`APP_CHECK_ENFORCEMENT must be one of ${SUPPORTED_APP_CHECK_ENFORCEMENT_MODES.join(", ")}`,
	);
}

function resolveStreamEditPolicy(configured: string): StreamEditUnauthorizedPlatformPolicy {
	const normalized = configured.trim().toLowerCase();
	const match = SUPPORTED_STREAM_EDIT_POLICIES.find((policy) => policy === normalized);
	// An unrecognized value falls back to "filter" — today's behavior — so a
	// config typo can never silently enable the B1 tightening.
	return match ?? "filter";
}

function resolveVodTimezone(configured: string): string {
	const trimmed = configured.trim();
	if (!trimmed) {
		return "America/New_York";
	}
	try {
		new Intl.DateTimeFormat("en-CA", { timeZone: trimmed }).format(new Date());
		return trimmed;
	} catch {
		return "America/New_York";
	}
}

function resolveOptionalConfigValue(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function resolveRailwayDeployment(source: AppConfigSource): RailwayDeployment | undefined {
	const deploymentId = resolveOptionalConfigValue(source.railwayDeploymentId);
	if (!deploymentId) {
		return undefined;
	}

	return {
		deploymentId,
		replicaId: resolveOptionalConfigValue(source.railwayReplicaId),
		region: resolveOptionalConfigValue(source.railwayReplicaRegion),
	};
}

function parseBoolean(label: string, value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") {
		return true;
	}
	if (normalized === "false") {
		return false;
	}
	throw new Error(`${label} must be either true or false`);
}

function parseNumberWithDefault(label: string, value: string, fallback: number): number {
	const parsed = Number(value.trim());
	if (Number.isFinite(parsed)) {
		return parsed;
	}
	return fallback;
}

function parseCsvList(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseEnabledPluginIds(value: string | undefined): "all" | string[] {
	if (!value || value.trim() === "all") {
		return "all";
	}

	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function buildRedisConnectionUrl(source: AppConfigSource): string {
	const nodeEnv = normalizeNodeEnv(source.nodeEnv);
	const redisHost = source.redisHost?.trim();
	const redisPort = source.redisPort?.trim();

	// Default to the local Redis container in development and test.
	if ((nodeEnv === "development" || nodeEnv === "test") && !redisHost) {
		return DEFAULT_LOCAL_REDIS_URL;
	}

	if (!redisHost || !redisPort) {
		throw new Error(
			"REDIS_HOST and REDIS_PORT must be set when NODE_ENV is not development or test",
		);
	}

	const username = source.redisUsername?.trim();
	const password = source.redisPassword?.trim();
	let auth = "";
	if (username && password) {
		auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
	} else if (password) {
		auth = `:${encodeURIComponent(password)}@`;
	} else if (username) {
		auth = `${encodeURIComponent(username)}@`;
	}

	return `redis://${auth}${redisHost}:${redisPort}`;
}

function toAppConfig(source: AppConfigSource): AppConfigContract {
	const nodeEnv = normalizeNodeEnv(source.nodeEnv);
	const isProduction = nodeEnv === "production";

	return {
		nodeEnv,
		isProduction,
		isDevelopment: nodeEnv === "development",
		showApiReference: !isProduction,
		server: {
			port: parsePositiveInteger("PORT", source.port),
			hostname: nodeEnv === "development" ? "localhost" : "0.0.0.0",
			development: nodeEnv === "development",
		},
		metrics: {
			port: parsePositiveInteger("METRICS_SERVER_PORT", source.metricsPort),
		},
		graphql: {
			featuredEventsDirectStrapi:
				nodeEnv === "development" &&
				parseBoolean("FEATURED_EVENTS_DIRECT_STRAPI", source.featuredEventsDirectStrapi),
			rateLimitRps: parsePositiveInteger("GRAPHQL_RATE_LIMIT_RPS", source.graphqlRateLimitRps),
			requireKnownOperations: parseBoolean(
				"GRAPHQL_REQUIRE_KNOWN_OPERATIONS",
				source.graphqlRequireKnownOperations,
			),
		},
		backgroundWorkers: {
			enabled: parseBoolean("BACKGROUND_WORKERS_ENABLED", source.backgroundWorkersEnabled),
		},
		redis: {
			connectionUrl: buildRedisConnectionUrl(source),
		},
		lru: {
			max: parsePositiveInteger("LRU_CACHE_MAX", source.lruCacheMax),
			ttlMs: parsePositiveInteger("LRU_CACHE_TTL_MS", source.lruCacheTtlMs),
		},
		database: {
			poolMax: parsePositiveInteger("DB_POOL_MAX", source.dbPoolMax),
			connectionTimeoutMs: parsePositiveInteger(
				"DB_CONNECTION_TIMEOUT_MS",
				source.dbConnectionTimeoutMs,
			),
			idleTimeoutMs: parsePositiveInteger("DB_IDLE_TIMEOUT_MS", source.dbIdleTimeoutMs),
			connectionString: source.databaseUrl,
			statementTimeoutMs: parseNonNegativeInteger(
				"DB_STATEMENT_TIMEOUT_MS",
				source.dbStatementTimeoutMs,
			),
			slowQueryThresholdMs: parsePositiveInteger(
				"SLOW_QUERY_THRESHOLD_MS",
				source.slowQueryThresholdMs,
			),
		},
		streamEdit: {
			unauthorizedPlatformPolicy: resolveStreamEditPolicy(
				source.streamEditUnauthorizedPlatformPolicy,
			),
		},
		vod: {
			timezone: resolveVodTimezone(source.vodTimezone),
		},
		observability: {
			sentryDsn: source.sentryDsn,
			sentryEnabled: parseBoolean("SENTRY_ENABLED", source.sentryEnabled),
			sentrySampleRate: parseNumberWithDefault(
				"SENTRY_SAMPLE_RATE",
				source.sentrySampleRate,
				DEFAULT_SENTRY_SAMPLE_RATE,
			),
			sentryTracesSampleRate: parseNumberWithDefault(
				"SENTRY_TRACES_SAMPLE_RATE",
				source.sentryTracesSampleRate,
				DEFAULT_SENTRY_TRACES_SAMPLE_RATE,
			),
			stellateLoggerToken: source.stellateLoggerToken,
			stellatePurgeToken: source.stellatePurgeToken,
			stellateServiceName: source.stellateServiceName,
			otelSamplingRatio: Number(source.otelSamplingRatio) || 1,
			otelExporterOtlpHeaders: source.otelExporterOtlpHeaders,
			otelExporterOtlpTracesEndpoint: source.otelExporterOtlpTracesEndpoint,
			otelExporterOtlpEndpoint: source.otelExporterOtlpEndpoint,
			otelServiceName: source.otelServiceName,
			otelSampleRates: {
				production: parseNumberWithDefault(
					"OTEL_PROD_SAMPLE_RATE",
					source.otelProdSampleRate,
					0.05,
				),
				staging: parseNumberWithDefault(
					"OTEL_STAGING_SAMPLE_RATE",
					source.otelStagingSampleRate,
					0.25,
				),
				development: parseNumberWithDefault("OTEL_DEV_SAMPLE_RATE", source.otelDevSampleRate, 1),
			},
			slowRequestMs: parseNonNegativeInteger(
				"OBSERVABILITY_SLOW_REQUEST_MS",
				source.observabilitySlowRequestMs,
			),
			serviceRevisionName: resolveOptionalConfigValue(source.serviceRevisionName),
			projectId: resolveOptionalConfigValue(source.projectId),
			railway: resolveRailwayDeployment(source),
		},
		integrations: {
			sendgridApiKey: source.sendgridApiKey,
			gcsExportBucket: source.gcsExportBucket,
		},
		statsig: {
			serverSecretKey: resolveOptionalConfigValue(source.statsigServerSecretKey),
			environment: resolveOptionalConfigValue(source.statsigEnvironment),
			bootstrapClientSdkKey: resolveOptionalConfigValue(source.statsigClientSdkKey),
			enabled: Boolean(resolveOptionalConfigValue(source.statsigServerSecretKey)),
		},
		auth: {
			cloudRunServiceUrl: resolveOptionalConfigValue(source.cloudRunServiceUrl),
			googleInternalAllowedEmails: parseCsvList(source.googleInternalAllowedEmails),
		},
		appCheck: {
			enforcement: normalizeAppCheckEnforcementMode(source.appCheckEnforcement),
			allowedAppIds: parseCsvList(source.appCheckAllowedAppIds),
		},
		plugins: {
			enabledPluginIds: parseEnabledPluginIds(source.enabledIntegrationPlugins),
			expectedContractVersion: source.pluginContractVersionExpected.trim(),
		},
	};
}

const makeAppConfig = Effect.gen(function* () {
	const source = yield* appConfigSource;

	return yield* Effect.try({
		try: () => toAppConfig(source),
		catch: (error) =>
			new AppConfigError({
				detail: "Failed to resolve application configuration",
				cause: error,
			}),
	});
});

export class AppConfig extends Context.Service<AppConfig, AppConfigContract>()("AppConfig", {
	make: makeAppConfig,
}) {}

export const AppConfigLive = Layer.effect(AppConfig, AppConfig.make);

function currentProcessEnv(): Record<string, string> {
	const env = globalThis.process?.env ?? Bun.env;
	return Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] =>
			Predicate.isNotUndefined(entry[1]),
		),
	);
}

let cachedAppConfigSync: AppConfigContract | null = null;

/**
 * Resolve validated app config synchronously during startup.
 *
 * Memoized: the first call parses and normalizes the full environment; later
 * calls return the same object. Env vars are immutable for the lifetime of a
 * server process, and several call sites run at module scope or (before
 * memoization) per request, so re-resolving was pure overhead.
 */
export function loadAppConfigSync(): AppConfigContract {
	const envProvider = ConfigProvider.fromEnv({ env: currentProcessEnv() });
	const envLayer = ConfigProvider.layer(envProvider);
	const appConfigLayer = AppConfigLive.pipe(Layer.provide(envLayer));

	cachedAppConfigSync ??= Effect.runSync(
		Effect.provide(
			Effect.gen(function* () {
				return yield* AppConfig;
			}),
			appConfigLayer,
		),
	);
	return cachedAppConfigSync;
}
