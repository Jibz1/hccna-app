// Run with: bun test apps/server-rs/bench
// Covers the pure helpers the k6 scenarios share. All metric text here is synthetic.
import { describe, expect, test } from "bun:test";

import {
	campusSlugs,
	permutedIndex,
	pickWeighted,
	rngFor,
	sermonPage,
	upcomingEventSlugs,
} from "./k6/discovery.js";
import { deltas, histogramQuantile, snapshot } from "./k6/metrics.js";

const BOUNDS = ["0.005", "0.01", "0.025", "0.05", "0.1", "+Inf"];

interface Series {
	labels: string;
	cumulative: number[];
	sum: number;
}

/** One family block with a single `# TYPE` line and one set of rows per label set. */
function histogram(name: string, series: Series[]): string {
	const lines = [`# HELP ${name} synthetic`, `# TYPE ${name} histogram`];
	for (const { labels, cumulative, sum } of series) {
		BOUNDS.forEach((le, i) => {
			lines.push(`${name}_bucket{${labels},le="${le}"} ${cumulative[i]}`);
		});
		lines.push(`${name}_sum{${labels}} ${sum}`);
		lines.push(`${name}_count{${labels}} ${cumulative[cumulative.length - 1]}`);
	}
	return lines.join("\n");
}

describe("snapshot", () => {
	// Shaped like the TS /metrics: prom-client first, then the OTel copy of the same families.
	const tsText = [
		histogram("http_server_request_duration_seconds", [
			{
				labels: 'method="POST",path_group="/graphql",status_class="2xx"',
				cumulative: [0, 10, 90, 100, 100, 100],
				sum: 0.8,
			},
			{
				labels: 'method="GET",path_group="/healthz",status_class="2xx"',
				cumulative: [5, 5, 5, 5, 5, 5],
				sum: 0.01,
			},
		]),
		"# HELP service_request Count of service requests",
		"# TYPE service_request counter",
		'service_request{service="strapi",action="query"} 7',
		"# HELP graphql_envelop_request_duration Time spent",
		"# TYPE graphql_envelop_request_duration histogram",
		'graphql_envelop_request_duration_bucket{operationName="CoreDataQuery",operationType="query",le="+Inf"} 4',
		'graphql_envelop_request_duration_sum{operationName="CoreDataQuery",operationType="query"} 0.02',
		'graphql_envelop_request_duration_count{operationName="CoreDataQuery",operationType="query"} 4',
		"",
		// The OTel serializer repeats the histogram family and renames counters with _total.
		"# TYPE http_server_request_duration_seconds histogram",
		'http_server_request_duration_seconds_bucket{method="POST",path_group="/graphql",status_class="2xx",le="+Inf"} 999',
		'http_server_request_duration_seconds_sum{method="POST",path_group="/graphql",status_class="2xx"} 999',
		'http_server_request_duration_seconds_count{method="POST",path_group="/graphql",status_class="2xx"} 999',
		"# TYPE service_request_total counter",
		'service_request_total{service="strapi",action="query"} 999',
	].join("\n");

	test("keeps the first block of a family and groups by path", () => {
		const snap = snapshot(tsText, 1000);
		expect(snap.http?.count).toBe(100);
		expect(snap.http?.sum).toBeCloseTo(0.8);
		expect(snap.http?.buckets.at(-1)).toEqual(["+Inf", 100]);
		// Setup data crosses a JSON boundary in k6.
		expect(JSON.parse(JSON.stringify(snap)).http.buckets.at(-1)).toEqual(["+Inf", 100]);
		expect(snap.services["strapi/query"]?.count).toBe(7);
		expect(snap.operations.CoreDataQuery).toEqual({ count: 4, sum: 0.02 });
		// TS has no process collector.
		expect(snap.process.rssBytes).toBeNull();
	});

	test("reads Rust-style counters and the process collector", () => {
		const text = [
			"# TYPE service_request_total counter",
			'service_request_total{service="firebase",action="lookup"} 3',
			"# TYPE service_error_total counter",
			'service_error_total{service="firebase",action="lookup"} 1',
			"# TYPE service_request_duration histogram",
			'service_request_duration_bucket{service="firebase",action="lookup",le="+Inf"} 3',
			'service_request_duration_sum{service="firebase",action="lookup"} 0.3',
			'service_request_duration_count{service="firebase",action="lookup"} 3',
			"# TYPE process_resident_memory_bytes gauge",
			"process_resident_memory_bytes 12345678",
			"# TYPE process_cpu_seconds_total counter",
			"process_cpu_seconds_total 4.5",
			"# TYPE process_threads gauge",
			"process_threads 9",
		].join("\n");
		const snap = snapshot(text, 0);
		expect(snap.services["firebase/lookup"]).toEqual({ count: 3, errors: 1, sum: 0.3 });
		expect(snap.process).toEqual({
			rssBytes: 12345678,
			cpuSeconds: 4.5,
			threads: 9,
			openFds: null,
		});
	});
});

describe("deltas", () => {
	const make = (cumulative: number[], sum: number, at: number, cpu: number) =>
		snapshot(
			[
				histogram("http_server_request_duration_seconds", [
					{
						labels: 'method="POST",path_group="/graphql",status_class="2xx"',
						cumulative,
						sum,
					},
				]),
				"# TYPE process_cpu_seconds_total counter",
				`process_cpu_seconds_total ${cpu}`,
			].join("\n"),
			at,
		);

	test("computes requests, mean and bucket quantiles over the run", () => {
		const before = make([0, 0, 0, 0, 0, 0], 0, 0, 1);
		const after = make([0, 50, 99, 100, 100, 100], 1.5, 60_000, 7);
		const result = deltas(before, after);
		expect(result.graphql.requests).toBe(100);
		expect(result.graphql.meanMs).toBe(15);
		// Half of 100 requests fall in (0.005, 0.01]: the median sits at the top of that bucket.
		expect(result.graphql.p50Ms).toBe(10);
		expect(result.graphql.p99Ms).toBeGreaterThan(10);
		expect(result.graphql.p99Ms).toBeLessThanOrEqual(25);
		expect(result.process.cpuSeconds).toBe(6);
		expect(result.seconds).toBe(60);
		expect(result.counterReset).toBe(false);
	});

	test("flags a counter reset", () => {
		const before = make([0, 50, 99, 100, 100, 100], 1.5, 0, 7);
		const after = make([0, 1, 2, 2, 2, 2], 0.02, 1000, 0.1);
		expect(deltas(before, after).counterReset).toBe(true);
	});
});

describe("histogramQuantile", () => {
	test("interpolates inside a bucket and clamps the +Inf bucket", () => {
		expect(
			histogramQuantile(0.5, [
				[0.1, 0],
				[0.2, 10],
				[Infinity, 10],
			]),
		).toBeCloseTo(0.15);
		expect(
			histogramQuantile(0.99, [
				[0.1, 5],
				[Infinity, 10],
			]),
		).toBe(0.1);
		expect(histogramQuantile(0.5, [[Infinity, 0]])).toBeNull();
	});
});

describe("discovery helpers", () => {
	test("reads slugs and cursors out of responses", () => {
		expect(
			campusSlugs({ data: { campusesV2: { campuses: [{ slug: "example-a" }, { slug: "" }, {}] } } }),
		).toEqual(["example-a"]);
		expect(
			upcomingEventSlugs({
				data: {
					upcomingEventsByMonth: {
						months: [{ events: [{ slug: "e1" }, { slug: "e2" }] }, { events: [{ slug: "e1" }] }],
					},
				},
			}),
		).toEqual(["e1", "e2"]);
		expect(
			sermonPage({
				data: {
					sermons: {
						edges: [{ cursor: "c1" }, { cursor: "c2" }],
						pageInfo: { endCursor: "c2", hasNextPage: true },
					},
				},
			}),
		).toEqual({ cursors: ["c1", "c2"], endCursor: "c2", hasNextPage: true });
		expect(campusSlugs({ errors: [] })).toEqual([]);
	});

	test("permutedIndex visits every value once per cycle", () => {
		for (const size of [2, 7, 50, 1000, 9999]) {
			const seen = new Set<number>();
			for (let i = 0; i < size; i += 1) {
				seen.add(permutedIndex(i, size, 42));
			}
			expect(seen.size).toBe(size);
		}
		expect(permutedIndex(5, 1, 1)).toBe(0);
	});

	test("rngFor is repeatable per iteration and pickWeighted follows the weights", () => {
		expect(rngFor(1, 3)()).toBe(rngFor(1, 3)());
		expect(rngFor(1, 3)()).not.toBe(rngFor(1, 4)());
		const weights: [string, number][] = [
			["a", 1],
			["b", 3],
		];
		expect(pickWeighted(0.1, weights)).toBe("a");
		expect(pickWeighted(0.9, weights)).toBe("b");
	});
});
