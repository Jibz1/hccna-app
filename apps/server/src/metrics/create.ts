import { prometheusRegistry } from "@/platform/observability/prometheusRegistry";
import {
	Counter,
	Histogram,
	type CounterConfiguration,
	type HistogramConfiguration,
} from "prom-client";

export const DEFAULT_DURATION_HISTOGRAM_BUCKETS = [
	0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 20,
];

export function createCounter<T extends string>(opts: CounterConfiguration<T>) {
	return new Counter({
		...opts,
		registers: [...(opts.registers || []), prometheusRegistry],
	});
}

export function createHistogram<T extends string>(opts: HistogramConfiguration<T>) {
	return new Histogram({
		...opts,
		registers: [...(opts.registers || []), prometheusRegistry],
		// The default buckets go up to 10s. We extend with buckets for 15s and
		// 20s to match the server-level timeout
		buckets: opts.buckets ?? DEFAULT_DURATION_HISTOGRAM_BUCKETS,
	});
}
