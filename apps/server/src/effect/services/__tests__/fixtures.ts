import { RedisService } from "@/effect/RedisService";
import { Effect, Layer } from "effect";

import type { AppConfigContract } from "@/effect/AppConfig";

export const testAppConfig: AppConfigContract = {
	nodeEnv: "test",
	isProduction: false,
	isDevelopment: false,
	showApiReference: true,
	server: {
		port: 8080,
		hostname: "127.0.0.1",
		development: false,
	},
	metrics: {
		port: 9184,
	},
	graphql: {
		rateLimitRps: 3,
		requireKnownOperations: false,
		featuredEventsDirectStrapi: false,
	},
	backgroundWorkers: {
		enabled: true,
	},
	streamEdit: {
		unauthorizedPlatformPolicy: "filter",
	},
	redis: {
		connectionUrl: "redis://localhost:6379",
	},
	lru: {
		max: 1000,
		ttlMs: 60_000,
	},
	database: {
		poolMax: 5,
		connectionTimeoutMs: 5000,
		idleTimeoutMs: 30_000,
		connectionString: "postgresql://localhost:5432/test",
		statementTimeoutMs: 10_000,
		slowQueryThresholdMs: 500,
	},
	vod: {
		timezone: "America/New_York",
	},
	observability: {
		sentryDsn: undefined,
		sentryEnabled: false,
		sentrySampleRate: 0.8,
		sentryTracesSampleRate: 0.1,
		stellateLoggerToken: undefined,
		stellatePurgeToken: undefined,
		stellateServiceName: "hccna",
		otelSamplingRatio: 1,
		otelExporterOtlpHeaders: undefined,
		otelExporterOtlpTracesEndpoint: undefined,
		otelExporterOtlpEndpoint: undefined,
		otelServiceName: "hccna-backend",
		otelSampleRates: {
			production: 0.05,
			staging: 0.25,
			development: 1,
		},
		slowRequestMs: 2000,
		serviceRevisionName: undefined,
		projectId: undefined,
		railway: undefined,
	},
	integrations: {
		sendgridApiKey: "SG.test-key",
		gcsExportBucket: "export-bucket",
	},
	statsig: {
		enabled: false,
		serverSecretKey: undefined,
		environment: undefined,
		bootstrapClientSdkKey: undefined,
	},
	auth: {
		cloudRunServiceUrl: undefined,
		googleInternalAllowedEmails: [],
	},
	appCheck: {
		enforcement: "off",
		allowedAppIds: [],
	},
	plugins: {
		enabledPluginIds: "all",
		expectedContractVersion: "1.0.0",
	},
};

export interface RedisTestService {
	readonly get: (key: string) => Effect.Effect<string | null, unknown>;
	readonly mget: (keys: string[]) => Effect.Effect<(string | null)[], unknown>;
	readonly set: (key: string, value: string) => Effect.Effect<void, unknown>;
	readonly setex: (key: string, seconds: number, value: string) => Effect.Effect<void, unknown>;
	readonly incr: (key: string) => Effect.Effect<number, unknown>;
	readonly decr: (key: string) => Effect.Effect<number, unknown>;
	readonly ttl: (key: string) => Effect.Effect<number, unknown>;
	readonly expire: (key: string, seconds: number) => Effect.Effect<void, unknown>;
	readonly del: (key: string) => Effect.Effect<void, unknown>;
	readonly keys: (pattern: string) => Effect.Effect<string[], unknown>;
	readonly ping: () => Effect.Effect<unknown, unknown>;
}

export const makeMockRedis = <T extends Partial<RedisTestService>>(
	overrides?: T,
): RedisTestService & T =>
	({
		get: () => Effect.succeed(null),
		mget: () => Effect.succeed([]),
		set: () => Effect.void,
		setex: () => Effect.void,
		incr: () => Effect.succeed(1),
		decr: () => Effect.succeed(0),
		ttl: () => Effect.succeed(-1),
		expire: () => Effect.void,
		del: () => Effect.void,
		keys: () => Effect.succeed([]),
		ping: () => Effect.succeed("PONG"),
		...overrides,
	}) as RedisTestService & T;

export const makeRedisTestLayer = (redis: RedisTestService = makeMockRedis()) =>
	Layer.succeed(RedisService, redis as never);
