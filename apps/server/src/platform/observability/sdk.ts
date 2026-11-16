import { loadAppConfigSync } from "@/effect/AppConfig";
import {
	buildObservabilityResource,
	buildOpenTelemetryResourceAttributes,
	getAdaptiveSampleRateForEnv,
	getOtlpLogsEndpoint,
	getOtlpMetricsEndpoint,
	getOtlpTracesEndpoint,
	parseOtlpHeaders,
	shouldExportRemoteOtlp,
} from "@/platform/observability/config";
import { NodeSdk as EffectNodeSdk } from "@effect/opentelemetry";
import { type Attributes, type Context, type Link, type SpanKind } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	BatchSpanProcessor,
	SamplingDecision,
	TraceIdRatioBasedSampler,
	type Sampler,
	type SamplingResult,
} from "@opentelemetry/sdk-trace-base";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { OtlpLogger, OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/observability";

const FORCE_SAMPLE_SPAN_NAME_PREFIX = "force-sampled.";
const REMOTE_OTLP_EXPORT_INTERVAL_MS = {
	traces: 30_000,
	logs: 10_000,
	metrics: 60_000,
} as const;

function formatSeconds(milliseconds: number): `${number} seconds` {
	return `${milliseconds / 1000} seconds`;
}

const REMOTE_OTLP_EXPORT_INTERVALS = {
	traces: formatSeconds(REMOTE_OTLP_EXPORT_INTERVAL_MS.traces),
	logs: formatSeconds(REMOTE_OTLP_EXPORT_INTERVAL_MS.logs),
	metrics: formatSeconds(REMOTE_OTLP_EXPORT_INTERVAL_MS.metrics),
} as const;

class ManualMetricReader extends MetricReader {
	protected async onForceFlush(): Promise<void> {}
	protected async onShutdown(): Promise<void> {}
}

export const effectMetricReader = new ManualMetricReader();

class AdaptiveSampler implements Sampler {
	private readonly ratioSampler: TraceIdRatioBasedSampler;

	constructor(sampleRate: number) {
		this.ratioSampler = new TraceIdRatioBasedSampler(sampleRate);
	}

	// oxlint-disable-next-line max-params
	shouldSample(
		otelContext: Context,
		traceId: string,
		spanName: string,
		spanKind: SpanKind,
		attributes: Attributes,
		_links: Link[],
	): SamplingResult {
		if (
			spanName.startsWith(FORCE_SAMPLE_SPAN_NAME_PREFIX) ||
			attributes["telemetry.force_sample"] === true ||
			attributes["telemetry.force_sample"] === "true"
		) {
			return {
				decision: SamplingDecision.RECORD_AND_SAMPLED,
			};
		}

		return this.ratioSampler.shouldSample(otelContext, traceId);
	}

	toString(): string {
		return `AdaptiveSampler(${this.ratioSampler.toString()})`;
	}
}

const disabledInstrumentations = {
	"@opentelemetry/instrumentation-memcached": { enabled: false },
	"@opentelemetry/instrumentation-mongodb": { enabled: false },
	"@opentelemetry/instrumentation-mysql": { enabled: false },
	"@opentelemetry/instrumentation-pg": { enabled: false },
	"@opentelemetry/instrumentation-redis": { enabled: false },
	"@opentelemetry/instrumentation-express": { enabled: false },
	"@opentelemetry/instrumentation-koa": { enabled: false },
	"@opentelemetry/instrumentation-http": { enabled: true },
	"@opentelemetry/instrumentation-aws-lambda": { enabled: false },
	"@opentelemetry/instrumentation-restify": { enabled: false },
	"@opentelemetry/instrumentation-router": { enabled: false },
	"@opentelemetry/instrumentation-runtime-node": { enabled: false },
	"@opentelemetry/instrumentation-socket.io": { enabled: false },
	"@opentelemetry/instrumentation-tedious": { enabled: false },
	"@opentelemetry/instrumentation-undici": { enabled: false },
	"@opentelemetry/instrumentation-winston": { enabled: false },
} as const;

let globalOpenTelemetrySdk: NodeSDK | null = null;

export function initializeGlobalOpenTelemetry(): NodeSDK {
	if (globalOpenTelemetrySdk) {
		return globalOpenTelemetrySdk;
	}

	const appConfig = loadAppConfigSync();
	const observabilityConfig = appConfig.observability;
	const resource = resourceFromAttributes(
		buildOpenTelemetryResourceAttributes(observabilityConfig),
	);
	const spanProcessors = shouldExportRemoteOtlp(appConfig)
		? [
				new BatchSpanProcessor(
					new OTLPTraceExporter({
						url: getOtlpTracesEndpoint(observabilityConfig),
						headers: parseOtlpHeaders(observabilityConfig.otelExporterOtlpHeaders),
					}),
					{
						maxQueueSize: 2048,
						maxExportBatchSize: 512,
						scheduledDelayMillis: REMOTE_OTLP_EXPORT_INTERVAL_MS.traces,
						exportTimeoutMillis: 30_000,
					},
				),
			]
		: [];
	const sdk = new NodeSDK({
		resource,
		sampler: new AdaptiveSampler(
			getAdaptiveSampleRateForEnv(observabilityConfig, appConfig.nodeEnv),
		),
		spanProcessors,
		instrumentations: [getNodeAutoInstrumentations(disabledInstrumentations)],
	});

	sdk.start();
	globalOpenTelemetrySdk = sdk;
	return sdk;
}

const GlobalOpenTelemetryLive = Layer.effectDiscard(
	Effect.acquireRelease(Effect.sync(initializeGlobalOpenTelemetry), (sdk) =>
		Effect.tryPromise({
			try: async () => {
				await sdk.shutdown();
				if (globalOpenTelemetrySdk === sdk) {
					globalOpenTelemetrySdk = null;
				}
			},
			catch: (cause) => cause,
		}).pipe(
			Effect.catch((error) =>
				Effect.logWarning("OpenTelemetry SDK shutdown failed").pipe(
					Effect.annotateLogs({
						error: error instanceof Error ? error.message : String(error),
					}),
				),
			),
		),
	),
);

const EffectMetricsLive = EffectNodeSdk.layer(() => {
	const appConfig = loadAppConfigSync();

	return {
		resource: buildObservabilityResource(appConfig.observability),
		metricReader: effectMetricReader,
	};
});

const EffectNativeObservabilityLive = Layer.unwrap(
	Effect.sync(() => {
		const appConfig = loadAppConfigSync();
		const observabilityConfig = appConfig.observability;
		const resource = buildObservabilityResource(observabilityConfig);
		const headers = parseOtlpHeaders(observabilityConfig.otelExporterOtlpHeaders);

		if (!shouldExportRemoteOtlp(appConfig)) {
			return EffectMetricsLive;
		}

		return Layer.mergeAll(
			EffectMetricsLive,
			OtlpTracer.layer({
				url: getOtlpTracesEndpoint(observabilityConfig),
				resource,
				headers,
				exportInterval: REMOTE_OTLP_EXPORT_INTERVALS.traces,
				maxBatchSize: 512,
				shutdownTimeout: "3 seconds",
			}),
			OtlpLogger.layer({
				url: getOtlpLogsEndpoint(observabilityConfig),
				resource,
				headers,
				exportInterval: REMOTE_OTLP_EXPORT_INTERVALS.logs,
				maxBatchSize: 512,
				shutdownTimeout: "3 seconds",
			}),
			OtlpMetrics.layer({
				url: getOtlpMetricsEndpoint(observabilityConfig),
				resource,
				headers,
				exportInterval: REMOTE_OTLP_EXPORT_INTERVALS.metrics,
				shutdownTimeout: "3 seconds",
				temporality: "cumulative",
			}),
		).pipe(
			Layer.provideMerge(OtlpSerialization.layerJson),
			Layer.provideMerge(FetchHttpClient.layer),
		);
	}),
);

export const HybridObservabilityLive = Layer.mergeAll(
	GlobalOpenTelemetryLive,
	EffectNativeObservabilityLive,
);
