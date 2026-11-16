import { loadAppConfigSync } from "@/effect/AppConfig";
import {
	createCounter,
	createHistogram,
	DEFAULT_DURATION_HISTOGRAM_BUCKETS,
} from "@/metrics/create";
import { compactSpanAttributes } from "@/platform/observability/attributes";
import { getObservabilityMetricContext } from "@/platform/observability/metricContext";
import { sanitizeTelemetryData } from "@/platform/observability/redaction";
import { SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";
import { Metric } from "effect";

import type { ObservabilityConfig } from "@/platform/observability/config";

const requestDurationHistogram = createHistogram({
	name: "http_server_request_duration_seconds",
	help: "Server request duration in seconds",
	labelNames: ["method", "path_group", "status_class"],
});

const requestErrorCounter = createCounter({
	name: "http_server_errors_total",
	help: "Count of HTTP 5xx responses",
	labelNames: ["method", "path_group"],
});

const forcedSampleCounter = createCounter({
	name: "telemetry_forced_sample_total",
	help: "Count of force-sampled telemetry events",
	labelNames: ["reason", "method", "path_group"],
});

const otlpRequestDurationHistogram = Metric.histogram("http_server_request_duration_seconds", {
	description: "Server request duration in seconds",
	boundaries: DEFAULT_DURATION_HISTOGRAM_BUCKETS,
});

const otlpRequestErrorCounter = Metric.counter("http_server_errors_total", {
	description: "Count of HTTP 5xx responses",
	incremental: true,
});

const otlpForcedSampleCounter = Metric.counter("telemetry_forced_sample_total", {
	description: "Count of force-sampled telemetry events",
	incremental: true,
});

const otlpGraphQLRequestCounter = Metric.counter("graphql_envelop_request", {
	description: "Counts the amount of GraphQL requests executed through Envelop",
	incremental: true,
});

const otlpGraphQLRequestDurationHistogram = Metric.histogram("graphql_envelop_request_duration", {
	description: "Time spent on running the GraphQL operation from parse to execute",
	boundaries: DEFAULT_DURATION_HISTOGRAM_BUCKETS,
});

const defaultTracer = trace.getTracer("hccna-backend.observability");

export interface CorrelationContext {
	requestId?: string | undefined;
	traceId?: string | undefined;
	spanId?: string | undefined;
}

export interface ClientTelemetryMetadata {
	appVersion: string;
	appBuild: string;
	deviceType: string;
	deviceModel: string;
	osName: string;
	osVersion: string;
}

export interface RequestTelemetryInput {
	method: string;
	/** The route pattern that answered (`/graphql`, `/v1/*`); absent when no route matched. */
	route?: string;
	status: number;
	durationMs: number;
	correlation?: CorrelationContext;
	client?: ClientTelemetryMetadata;
	graphql?: {
		operationName: string;
		operationType: string;
	};
}

function shouldForceSample(
	status: number,
	durationMs: number,
	slowRequestMs = loadAppConfigSync().observability.slowRequestMs,
): boolean {
	return status >= 500 || durationMs >= slowRequestMs;
}

function getForceSampleReason(
	status: number,
	durationMs: number,
	slowRequestMs: number,
): "error" | "slow" {
	if (status >= 500) {
		return "error";
	}

	if (durationMs >= slowRequestMs) {
		return "slow";
	}

	return "slow";
}

// Raw paths are unbounded: scanners probe thousands, and each became its own metric series.
const UNMATCHED_PATH_GROUP = "unmatched";

// Clients choose the method string too, so anything outside the standard set shares one label.
const STANDARD_METHODS: ReadonlySet<string> = new Set([
	"GET",
	"HEAD",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS",
]);

function methodLabel(method: string): string {
	const upper = method.toUpperCase();
	return STANDARD_METHODS.has(upper) ? upper : "OTHER";
}

function statusClass(status: number): string {
	return `${Math.floor(status / 100)}xx`;
}

export function getCorrelationContext(headers: Headers, requestId?: string): CorrelationContext {
	const traceparent = headers.get("traceparent");
	if (!traceparent) {
		return { requestId };
	}

	const [, traceId, spanId] = traceparent.split("-");

	if (!traceId || !spanId) {
		return { requestId };
	}

	return {
		requestId,
		traceId,
		spanId,
	};
}

function normalizeClientLabel(value: string | null | undefined): string {
	const normalized = [...(value?.trim() ?? "")]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint >= 32 && codePoint !== 127;
		})
		.join("");
	if (!normalized) {
		return "unknown";
	}

	return normalized.slice(0, 80);
}

function readHeader(headers: Headers, names: readonly string[]): string | null {
	for (const name of names) {
		const value = headers.get(name);
		if (value) {
			return value;
		}
	}

	return null;
}

function inferOsNameFromUserAgent(userAgent: string | null): string {
	if (!userAgent) {
		return "unknown";
	}

	if (/android/iu.test(userAgent)) {
		return "Android";
	}

	if (/(?:iphone|ipad|ios)/iu.test(userAgent)) {
		return "iOS";
	}

	if (/windows/iu.test(userAgent)) {
		return "Windows";
	}

	if (/mac os|macintosh/iu.test(userAgent)) {
		return "macOS";
	}

	if (/linux/iu.test(userAgent)) {
		return "Linux";
	}

	return "unknown";
}

function inferDeviceTypeFromUserAgent(userAgent: string | null): string {
	if (!userAgent) {
		return "unknown";
	}

	if (/(?:ipad|tablet)/iu.test(userAgent)) {
		return "tablet";
	}

	if (/(?:iphone|android.*mobile|mobile)/iu.test(userAgent)) {
		return "phone";
	}

	return "desktop";
}

export function getClientTelemetryMetadata(headers: Headers): ClientTelemetryMetadata {
	const userAgent = headers.get("user-agent");

	return {
		appVersion: normalizeClientLabel(readHeader(headers, ["x-hccna-app-version", "x-app-version"])),
		appBuild: normalizeClientLabel(readHeader(headers, ["x-hccna-app-build", "x-app-build"])),
		deviceType: normalizeClientLabel(
			readHeader(headers, ["x-hccna-device-type", "x-device-type"]) ??
				inferDeviceTypeFromUserAgent(userAgent),
		),
		deviceModel: normalizeClientLabel(
			readHeader(headers, ["x-hccna-device-model", "x-device-model"]),
		),
		osName: normalizeClientLabel(
			readHeader(headers, ["x-hccna-os-name", "x-hccna-platform", "x-os-name", "x-platform"]) ??
				inferOsNameFromUserAgent(userAgent),
		),
		osVersion: normalizeClientLabel(readHeader(headers, ["x-hccna-os-version", "x-os-version"])),
	};
}

function clientMetricLabels(client?: ClientTelemetryMetadata) {
	return {
		app_version: client?.appVersion ?? "unknown",
		device_type: client?.deviceType ?? "unknown",
		os_name: client?.osName ?? "unknown",
	};
}

export function makeRequestTelemetryRecorder(
	config: Pick<ObservabilityConfig, "slowRequestMs">,
	tracer: Tracer = defaultTracer,
) {
	return (input: RequestTelemetryInput) => {
		const pathGroup = input.route ?? UNMATCHED_PATH_GROUP;
		const labels = {
			method: methodLabel(input.method),
			path_group: pathGroup,
			status_class: statusClass(input.status),
		};

		requestDurationHistogram.observe(labels, input.durationMs / 1000);
		Metric.withAttributes(otlpRequestDurationHistogram, labels).updateUnsafe(
			input.durationMs / 1000,
			getObservabilityMetricContext(),
		);

		if (input.status >= 500) {
			requestErrorCounter.inc({
				method: labels.method,
				path_group: labels.path_group,
			});
			Metric.withAttributes(otlpRequestErrorCounter, {
				method: labels.method,
				path_group: labels.path_group,
			}).updateUnsafe(1, getObservabilityMetricContext());
		}

		if (pathGroup === "/graphql" && input.graphql) {
			const graphqlLabels = {
				operationName: input.graphql.operationName,
				operationType: input.graphql.operationType,
				...clientMetricLabels(input.client),
			};
			Metric.withAttributes(otlpGraphQLRequestCounter, graphqlLabels).updateUnsafe(
				1,
				getObservabilityMetricContext(),
			);
			Metric.withAttributes(otlpGraphQLRequestDurationHistogram, graphqlLabels).updateUnsafe(
				input.durationMs / 1000,
				getObservabilityMetricContext(),
			);
		}

		if (!shouldForceSample(input.status, input.durationMs, config.slowRequestMs)) {
			return;
		}

		const reason = getForceSampleReason(input.status, input.durationMs, config.slowRequestMs);
		forcedSampleCounter.inc({
			reason,
			method: labels.method,
			path_group: labels.path_group,
		});
		Metric.withAttributes(otlpForcedSampleCounter, {
			reason,
			method: labels.method,
			path_group: labels.path_group,
		}).updateUnsafe(1, getObservabilityMetricContext());

		const span = tracer.startSpan("force-sampled.http.request", {
			attributes: compactSpanAttributes(
				sanitizeTelemetryData({
					"telemetry.force_sample": true,
					"telemetry.force_reason": reason,
					"http.method": labels.method,
					"http.route": labels.path_group,
					"http.status_code": input.status,
					"http.request.duration_ms": input.durationMs,
					"request.id": input.correlation?.requestId,
					"trace.id": input.correlation?.traceId,
					"span.id": input.correlation?.spanId,
					"client.app.version": input.client?.appVersion,
					"client.app.build": input.client?.appBuild,
					"client.device.type": input.client?.deviceType,
					"client.device.model": input.client?.deviceModel,
					"client.os.name": input.client?.osName,
					"client.os.version": input.client?.osVersion,
				}),
			),
		});

		if (input.status >= 400) {
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: `HTTP ${input.status}`,
			});
		} else {
			span.setStatus({ code: SpanStatusCode.OK });
		}

		span.end();
	};
}

let defaultRequestTelemetryRecorder: ReturnType<typeof makeRequestTelemetryRecorder> | null = null;

export function recordRequestTelemetry(input: RequestTelemetryInput) {
	defaultRequestTelemetryRecorder ??= makeRequestTelemetryRecorder(
		loadAppConfigSync().observability,
	);
	defaultRequestTelemetryRecorder(input);
}
