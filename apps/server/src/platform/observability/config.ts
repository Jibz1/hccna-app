import { Predicate } from "effect";

import type { AppConfigContract } from "@/effect/AppConfig";
import type { Attributes } from "@opentelemetry/api";

export type ObservabilityConfig = AppConfigContract["observability"];

export function shouldExportRemoteOtlp(
	appConfig: Pick<AppConfigContract, "isDevelopment" | "nodeEnv" | "observability">,
): boolean {
	const { otelExporterOtlpEndpoint, otelExporterOtlpTracesEndpoint } = appConfig.observability;
	const hasEndpoint = Boolean(otelExporterOtlpEndpoint) || Boolean(otelExporterOtlpTracesEndpoint);

	return hasEndpoint && !appConfig.isDevelopment && appConfig.nodeEnv !== "test";
}

export function parseOtlpHeaders(headerValue: string | undefined) {
	if (!headerValue) {
		return {};
	}

	return Object.fromEntries(
		headerValue
			.split(",")
			.map((header) => {
				const [key = "", ...rest] = header.split("=");
				const value = rest.join("=").trim();
				try {
					return [key.trim(), decodeURIComponent(value)] as const;
				} catch {
					return [key.trim(), value] as const;
				}
			})
			.filter(([key]) => key.length > 0),
	);
}

function isGrafanaOtlpGateway(base: string): boolean {
	try {
		return new URL(base).hostname.endsWith(".grafana.net");
	} catch {
		return false;
	}
}

function getOtlpEndpoint(base: string, signalPath: "traces" | "logs" | "metrics") {
	const normalized = base.replace(/\/$/u, "");
	if (normalized.endsWith(`/v1/${signalPath}`)) {
		return normalized;
	}

	if (normalized.endsWith("/otlp")) {
		return `${normalized}/v1/${signalPath}`;
	}

	if (isGrafanaOtlpGateway(normalized)) {
		return `${normalized}/otlp/v1/${signalPath}`;
	}

	return `${normalized}/v1/${signalPath}`;
}

export function getOtlpTracesEndpoint(
	config: Pick<ObservabilityConfig, "otelExporterOtlpEndpoint" | "otelExporterOtlpTracesEndpoint">,
): string {
	const base = config.otelExporterOtlpTracesEndpoint ?? config.otelExporterOtlpEndpoint;

	if (!base) {
		return "http://localhost:4318/v1/traces";
	}

	return getOtlpEndpoint(base, "traces");
}

export function getOtlpLogsEndpoint(
	config: Pick<ObservabilityConfig, "otelExporterOtlpEndpoint" | "otelExporterOtlpTracesEndpoint">,
): string {
	if (config.otelExporterOtlpEndpoint) {
		return getOtlpEndpoint(config.otelExporterOtlpEndpoint, "logs");
	}

	return getOtlpTracesEndpoint(config).replace(/\/v1\/traces$/u, "/v1/logs");
}

export function getOtlpMetricsEndpoint(
	config: Pick<ObservabilityConfig, "otelExporterOtlpEndpoint" | "otelExporterOtlpTracesEndpoint">,
): string {
	if (config.otelExporterOtlpEndpoint) {
		return getOtlpEndpoint(config.otelExporterOtlpEndpoint, "metrics");
	}

	return getOtlpTracesEndpoint(config).replace(/\/v1\/traces$/u, "/v1/metrics");
}

function parseResourceAttributes(
	value = globalThis.process?.env?.OTEL_RESOURCE_ATTRIBUTES,
): Attributes {
	if (!value) {
		return {};
	}

	try {
		return Object.fromEntries(
			value.split(",").map((entry) => {
				const separatorIndex = entry.indexOf("=");
				if (separatorIndex < 1) {
					throw new Error("Invalid OTEL_RESOURCE_ATTRIBUTES entry");
				}

				return [
					decodeURIComponent(entry.slice(0, separatorIndex)),
					decodeURIComponent(entry.slice(separatorIndex + 1)),
				];
			}),
		);
	} catch {
		return {};
	}
}

// Grafana Cloud derives `job` from service.namespace/service.name and
// `instance` from service.instance.id, so these keep Railway series apart
// from Cloud Run's instead of merging into one cumulative stream.
function railwayResourceAttributes(railway: ObservabilityConfig["railway"]): Attributes {
	if (!railway) {
		return {};
	}

	return {
		"service.namespace": "railway",
		"service.instance.id": railway.replicaId,
		"cloud.provider": "railway",
		"cloud.region": railway.region,
	};
}

export function buildObservabilityResource(config: ObservabilityConfig) {
	const attributes: Attributes = {
		...railwayResourceAttributes(config.railway),
		...parseResourceAttributes(),
		"service.revision": config.serviceRevisionName ?? config.railway?.deploymentId,
		"gcp.project_id": config.projectId,
	};

	return {
		serviceName: config.otelServiceName,
		attributes: Object.fromEntries(
			Object.entries(attributes).filter(([, value]) => Predicate.isNotUndefined(value)),
		),
	};
}

export function buildOpenTelemetryResourceAttributes(config: ObservabilityConfig): Attributes {
	const resource = buildObservabilityResource(config);

	return {
		...resource.attributes,
		"service.name": resource.serviceName,
	};
}

export function getAdaptiveSampleRateForEnv(config: ObservabilityConfig, env: string): number {
	if (env === "production") {
		return config.otelSampleRates.production;
	}

	if (env === "staging") {
		return config.otelSampleRates.staging;
	}

	return config.otelSampleRates.development;
}
