import { AppConfig, AppConfigLive } from "@/effect/AppConfig";
import { testAppConfig } from "@/effect/services/__tests__/fixtures";
import {
	buildObservabilityResource,
	shouldExportRemoteOtlp,
} from "@/platform/observability/config";
import { afterEach, describe, expect, it } from "bun:test";
import { ConfigProvider, Effect, Layer } from "effect";

const loadConfig = (env: Record<string, string>) => {
	const configProvider = ConfigProvider.layer(ConfigProvider.fromEnv({ env }));
	const configLayer = AppConfigLive.pipe(Layer.provide(configProvider));
	const program = Effect.gen(function* () {
		return yield* AppConfig;
	});
	return Effect.runSync(program.pipe(Effect.provide(configLayer)));
};

const railwayObservability = {
	...testAppConfig.observability,
	railway: {
		deploymentId: "deploy-123",
		replicaId: "replica-abc",
		region: "us-east4-eqdc4a",
	},
};

describe("observability resource", () => {
	const originalResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES;

	afterEach(() => {
		if (originalResourceAttributes === undefined) {
			delete process.env.OTEL_RESOURCE_ATTRIBUTES;
		} else {
			process.env.OTEL_RESOURCE_ATTRIBUTES = originalResourceAttributes;
		}
	});

	it("reads Railway deployment variables into config", () => {
		const config = loadConfig({
			RAILWAY_DEPLOYMENT_ID: "deploy-123",
			RAILWAY_REPLICA_ID: "replica-abc",
			RAILWAY_REPLICA_REGION: "us-east4-eqdc4a",
		});

		expect(config.observability.railway).toEqual({
			deploymentId: "deploy-123",
			replicaId: "replica-abc",
			region: "us-east4-eqdc4a",
		});
	});

	it("leaves Railway config unset outside Railway", () => {
		expect(loadConfig({}).observability.railway).toBeUndefined();
	});

	it("keeps the Cloud Run resource free of Railway attributes", () => {
		delete process.env.OTEL_RESOURCE_ATTRIBUTES;

		const resource = buildObservabilityResource(testAppConfig.observability);

		expect(resource).toEqual({ serviceName: "hccna-backend", attributes: {} });
	});

	it("namespaces Railway telemetry and identifies the replica", () => {
		delete process.env.OTEL_RESOURCE_ATTRIBUTES;

		const resource = buildObservabilityResource(railwayObservability);

		expect(resource.serviceName).toBe("hccna-backend");
		expect(resource.attributes).toEqual({
			"service.namespace": "railway",
			"service.instance.id": "replica-abc",
			"service.revision": "deploy-123",
			"cloud.provider": "railway",
			"cloud.region": "us-east4-eqdc4a",
		});
	});

	it("prefers SERVICE_REVISION_NAME over the Railway deployment id", () => {
		delete process.env.OTEL_RESOURCE_ATTRIBUTES;

		const resource = buildObservabilityResource({
			...railwayObservability,
			serviceRevisionName: "rev-7",
		});

		expect(resource.attributes["service.revision"]).toBe("rev-7");
	});

	it("lets OTEL_RESOURCE_ATTRIBUTES override Railway defaults", () => {
		process.env.OTEL_RESOURCE_ATTRIBUTES = "service.namespace=standby";

		const resource = buildObservabilityResource(railwayObservability);

		expect(resource.attributes["service.namespace"]).toBe("standby");
	});
});

describe("remote OTLP export", () => {
	const production = { ...testAppConfig, nodeEnv: "production" as const };

	it("is skipped when no OTLP endpoint is configured", () => {
		expect(shouldExportRemoteOtlp(production)).toBe(false);
	});

	it("is enabled by OTEL_EXPORTER_OTLP_ENDPOINT", () => {
		expect(
			shouldExportRemoteOtlp({
				...production,
				observability: {
					...production.observability,
					otelExporterOtlpEndpoint: "https://otlp-gateway.grafana.net/otlp",
				},
			}),
		).toBe(true);
	});

	it("is enabled by OTEL_EXPORTER_OTLP_TRACES_ENDPOINT alone", () => {
		expect(
			shouldExportRemoteOtlp({
				...production,
				observability: {
					...production.observability,
					otelExporterOtlpTracesEndpoint: "https://collector.example/v1/traces",
				},
			}),
		).toBe(true);
	});

	it("stays off in development even with an endpoint", () => {
		expect(
			shouldExportRemoteOtlp({
				...production,
				nodeEnv: "development",
				isDevelopment: true,
				observability: {
					...production.observability,
					otelExporterOtlpEndpoint: "https://otlp-gateway.grafana.net/otlp",
				},
			}),
		).toBe(false);
	});
});
