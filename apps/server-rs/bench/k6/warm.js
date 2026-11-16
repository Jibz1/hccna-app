// warm: fixed variables, so after one priming pass nearly every request is a response-cache hit.
// What it isolates: HTTP handling, request parsing, the cache lookup and response serialization.
//
// Steps up through WARM_STEPS (requests per second, default 10,25,50,100; each capped at 100), STEP_SECONDS
// each (default 60). Every step is its own constant-arrival-rate scenario (an open model, so a slow
// target cannot hide latency by slowing the load) and they run back to back.

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

const MAX_RPS = 100;
const STEP_GAP_SECONDS = 2;
const STEP_SECONDS = positiveInt(__ENV.STEP_SECONDS, 60);
const STEPS = (__ENV.WARM_STEPS || "10,25,50,100")
  .split(",")
  .map((value) => cappedRate(value.trim(), 10, MAX_RPS));

const scenarios = {};
const slices = [];
let startSeconds = 0;
STEPS.forEach((rate, index) => {
  const name = `step${index + 1}_${rate}rps`;
  scenarios[name] = {
    executor: "constant-arrival-rate",
    exec: "load",
    rate,
    timeUnit: "1s",
    duration: `${STEP_SECONDS}s`,
    startTime: `${startSeconds}s`,
    preAllocatedVUs: Math.max(5, Math.ceil(rate / 5)),
    maxVUs: Math.max(50, rate * 2),
    gracefulStop: "10s",
  };
  slices.push({
    type: "step",
    name,
    rate,
    selector: `{scenario:${name}}`,
    offsetSeconds: startSeconds,
    durationSeconds: STEP_SECONDS,
  });
  startSeconds += STEP_SECONDS + STEP_GAP_SECONDS;
});
assertShortEnough(startSeconds);

const operationNames = [...OPERATIONS.keys()];
for (const name of operationNames) {
  slices.push({ type: "operation", name, selector: `{op:${name}}` });
}

export const options = {
  ...baseOptions,
  scenarios,
  thresholds: summaryThresholds(slices.map((slice) => slice.selector.slice(1, -1))),
};

export function setup() {
  return prepare({
    tokenCount: 1,
    cursorLimit: 0,
    scrape: "end",
    // One request per operation so the first measured request is already a hit.
    prime(found, tokens) {
      for (const item of fixedPlan(found)) {
        send(OPERATIONS.get(item.name), item.variables, tokens[0], { setup_op: item.name });
      }
    },
  });
}

let plan;

export function load(data) {
  if (plan === undefined) plan = fixedPlan(data.found);
  const i = iteration();
  const item = plan[i % plan.length];
  send(OPERATIONS.get(item.name), item.variables, data.tokens[0], { op: item.name });
}

export function handleSummary(data) {
  return summarize(data, {
    scenario: "warm",
    config: { steps: STEPS, stepSeconds: STEP_SECONDS },
    slices,
  });
}
