// cold: upstream-bound latency. Run it right after the operator flushes the bench Redis and
// restarts the target (RUNBOOK.md), so every cache layer is empty. At most 2 requests per second:
// the first touch of each operation goes to Strapi, Postgres, Firestore or the CCB forms
// endpoint, all shared with production.
//
// The plan is every operation once with fixed variables (PASSES times, default 3). Pass 1 is the
// cold measurement; later passes show the same requests once the caches are filled. The
// setup phase must discover campus and event slugs first (no sermon cursors: cursorLimit 0), and
// those requests are themselves first touches of CampusesQuery, LatestEventsQuery and the Strapi
// record cache; their timings are reported in the "setup" line as `discovery`. The run is marked
// invalid (`fresh: false`) when the target had already served GraphQL requests, i.e. it was not
// restarted after the Redis flush.

import {
  OPERATIONS,
  assertShortEnough,
  baseOptions,
  cappedRate,
  fixedPlan,
  iteration,
  positiveInt,
  prepare,
  send,
  summarize,
  summaryThresholds,
} from "./lib.js";

const MAX_RPS = 2;
const RATE = cappedRate(__ENV.RATE, 1, MAX_RPS);
const PASSES = Math.min(positiveInt(__ENV.PASSES, 3), 10);
const operationNames = [...OPERATIONS.keys()];
const DURATION_SECONDS = Math.ceil((operationNames.length * PASSES) / RATE);
assertShortEnough(DURATION_SECONDS);

const slices = [
  { type: "pass", name: "1", selector: "{pass:1}" },
  { type: "pass", name: "later", selector: "{pass:later}" },
];
for (const name of operationNames) {
  slices.push({ type: "operation-first", name, selector: `{op:${name},pass:1}` });
  slices.push({ type: "operation-later", name, selector: `{op:${name},pass:later}` });
}

export const options = {
  ...baseOptions,
  scenarios: {
    cold: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: `${DURATION_SECONDS}s`,
      preAllocatedVUs: 5,
      // Cold requests can take seconds, so several are in flight at once.
      maxVUs: 20,
      gracefulStop: "30s",
    },
  },
  thresholds: summaryThresholds(slices.map((slice) => slice.selector.slice(1, -1))),
};

export function setup() {
  // Metrics are scraped first so the server deltas include the first touches made by discovery.
  return prepare({ tokenCount: 1, cursorLimit: 0, scrape: "start" });
}

let plan;

export default function (data) {
  if (plan === undefined) plan = fixedPlan(data.found);
  const i = iteration();
  // The arrival schedule can start one iteration more than planned; skip it.
  if (i >= plan.length * PASSES) return;
  const item = plan[i % plan.length];
  const pass = Math.floor(i / plan.length) + 1;
  send(OPERATIONS.get(item.name), item.variables, data.tokens[0], {
    op: item.name,
    pass: pass === 1 ? "1" : "later",
  });
}

export function handleSummary(data) {
  return summarize(data, {
    scenario: "cold",
    config: { rate: RATE, passes: PASSES },
    slices,
    // A server that already served GraphQL is not cold.
    requireFresh: true,
  });
}
