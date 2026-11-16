import {
	createCounter,
	createHistogram,
	DEFAULT_DURATION_HISTOGRAM_BUCKETS,
} from "@/metrics/create";
import { getObservabilityMetricContext } from "@/platform/observability/metricContext";
import * as Sentry from "@sentry/bun";
import { Metric } from "effect";

const DEFAULT_TIME_OUT = 5000;

const requestCounter = createCounter({
	name: "service_request",
	help: "Count of service requests",
	labelNames: ["service", "action"],
});

const requestDurationHistogram = createHistogram({
	name: "service_request_duration",
	help: "Duration of service requests",
	labelNames: ["service", "action"],
});

const errorCounter = createCounter({
	name: "service_error",
	help: "Count of service errors",
	labelNames: ["service", "action"],
});

const otlpRequestCounter = Metric.counter("service_request", {
	description: "Count of service requests",
	incremental: true,
});

const otlpRequestDurationHistogram = Metric.histogram("service_request_duration", {
	description: "Duration of service requests",
	boundaries: DEFAULT_DURATION_HISTOGRAM_BUCKETS,
});

const otlpErrorCounter = Metric.counter("service_error", {
	description: "Count of service errors",
	incremental: true,
});

function fetchWithTimeout(
	url: string,
	options?: RequestInit & { timeout?: number },
): Promise<Response> {
	const { timeout, ...fetchOptions } = options || {};
	const signal = AbortSignal.any([
		AbortSignal.timeout(timeout || DEFAULT_TIME_OUT),
		...(fetchOptions.signal ? [fetchOptions.signal] : []),
	]);

	return fetch(url, {
		...fetchOptions,
		signal,
	});
}

interface InstrumentationParams {
	/**
	 * Which service we're making the request to.
	 *
	 * This will appear as a label in metrics so DO NOT use a dynamic value
	 * here.
	 */
	service: string;

	/**
	 * What action we're performing.
	 *
	 * This will appear as a label in metrics so DO NOT use a dynamic value
	 * here.
	 */
	action: string;

	/**
	 * Optional span attributes.
	 */
	attributes?: Record<string, string>;
}

/**
 * Wrapper function to add basic instrumentation around a function call,
 * intended for wrapping external API calls. When heyapi adds better support for
 * custom clients we can maybe get rid of this
 * https://heyapi.dev/openapi-ts/clients/custom
 */
function withServiceMetrics<T>(
	fn: () => Promise<T>,
	instrumentationParams: InstrumentationParams,
): Promise<T> {
	const { service, action, attributes } = instrumentationParams;

	const labels = { service, action };

	return Sentry.startSpan({ op: "function", name: `${service}.${action}` }, async (span) => {
		if (attributes) {
			span.setAttributes(attributes);
		}

		const start = performance.now();
		try {
			return await fn();
		} catch (error) {
			errorCounter.inc(labels);
			Metric.withAttributes(otlpErrorCounter, labels).updateUnsafe(
				1,
				getObservabilityMetricContext(),
			);
			throw error;
		} finally {
			const duration = performance.now() - start;
			requestDurationHistogram.observe(labels, duration / 1000);
			requestCounter.inc(labels);
			Metric.withAttributes(otlpRequestDurationHistogram, labels).updateUnsafe(
				duration / 1000,
				getObservabilityMetricContext(),
			);
			Metric.withAttributes(otlpRequestCounter, labels).updateUnsafe(
				1,
				getObservabilityMetricContext(),
			);
		}
	});
}

export function serviceRequest({
	url,
	options,
	...rest
}: {
	/**
	 * URL to fetch, same as first argument to `fetch`.
	 */
	url: string;
	/**
	 * Same as second argument to `fetch` with optional timeout ms.
	 */
	options?: RequestInit & { timeout?: number };
} & InstrumentationParams) {
	return withServiceMetrics(() => fetchWithTimeout(url, options), rest);
}
