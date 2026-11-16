// Shared k6 plumbing for the warm, resolver and cold scenarios.
//
// One run exercises ONE target (TARGET_URL) with ONE scenario. The runbook runs the two targets
// one after the other, never together. Environment:
//
//   TARGET_URL            required, e.g. http://hccna-backend-rs.railway.internal:8080
//   TARGET_METRICS_URL    optional, e.g. http://hccna-backend-rs.railway.internal:9184 (/metrics is appended)
//   TARGET_NAME           label for the summary ("rs" or "ts"); defaults to "target"
//   FIREBASE_WEB_API_KEY  required; the Firebase web key used for anonymous sign-in (never committed;
//                         sent as the x-goog-api-key header, never in a URL)
//   IDENTITY_TOOLKIT_URL  default https://identitytoolkit.googleapis.com (override only for tests)
//   SEED                  default 1; seeds the request variation so two targets get the same sequence
//
// Requests copy what the mobile app sends (apps/mobile/src/effect/graphqlNetworkService.ts):
// POST {query, variables} with no operationName, gzip accepted, a Firebase bearer token and the
// x-hccna-* client headers. Tokens are never logged.
//
// Targets are checked against a denylist (guard.js): the live hccna-backend, production domains
// and the production Redis are refused.

import http from "k6/http";
import exec from "k6/execution";
import { fail } from "k6";
import { Rate, Trend } from "k6/metrics";

import { classifyResponse } from "./classify.js";
import { campusSlugs, sermonPage, upcomingEventSlugs } from "./discovery.js";
import { assertAllowedUrl } from "./guard.js";
import { deltas, snapshot } from "./metrics.js";

const operationsFile = JSON.parse(open("../operations.json"));

/** Operation name -> {name, text, variables}. */
export const OPERATIONS = new Map(operationsFile.operations.map((op) => [op.name, op]));

const trimSlash = (value) => (value || "").replace(/\/+$/, "");

export const TARGET_URL = trimSlash(__ENV.TARGET_URL);
export const TARGET_METRICS_URL = trimSlash(__ENV.TARGET_METRICS_URL);
export const TARGET_NAME = __ENV.TARGET_NAME || "target";
export const SEED = positiveInt(__ENV.SEED, 1);
const IDENTITY_TOOLKIT_URL = trimSlash(
  __ENV.IDENTITY_TOOLKIT_URL || "https://identitytoolkit.googleapis.com",
);

/** Firebase ID tokens last an hour and these scenarios do not refresh them. */
export const MAX_SCENARIO_MINUTES = 50;

export function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Parses a rate, never exceeding `cap`: upstreams are shared with production. */
export function cappedRate(value, fallback, cap) {
  return Math.min(positiveInt(value, fallback), cap);
}

export const graphqlOk = new Rate("graphql_ok");
// Characters of the decoded body (JavaScript string length), not bytes on the wire.
export const responseChars = new Trend("response_chars", false);
export const responseGzip = new Rate("response_gzip");

/** Options every scenario shares. `scenarios` and `thresholds` are added per file. */
export const baseOptions = {
  setupTimeout: "180s",
  userAgent: "hccna-bench",
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
  // No "url" or "name" tag: the sign-up URL carries the Firebase key, and metric tags can reach
  // k6 outputs. Per-operation numbers use the "op" tag instead.
  systemTags: ["status", "method", "scenario", "expected_response", "group", "error", "error_code"],
};

/**
 * Sub-metrics only appear in the end-of-test summary when a threshold names them. These always
 * pass; they exist so handleSummary can read per-operation and per-step numbers.
 */
export function summaryThresholds(tagSets) {
  const thresholds = {};
  for (const tags of ["phase:load", ...tagSets]) {
    const selector = `{${tags}}`;
    thresholds[`http_req_duration${selector}`] = ["max>=0"];
    thresholds[`http_req_failed${selector}`] = ["rate>=0"];
    thresholds[`graphql_ok${selector}`] = ["rate>=0"];
    thresholds[`response_chars${selector}`] = ["max>=0"];
  }
  return thresholds;
}

function requireEnv(name, value) {
  if (!value) {
    fail(`${name} is not set (see apps/server-rs/bench/RUNBOOK.md)`);
  }
  return value;
}

function graphqlHeaders(token) {
  return {
    "content-type": "application/json",
    "accept-encoding": "gzip",
    authorization: `Bearer ${token}`,
    "x-hccna-app-version": "bench",
    "x-hccna-device-type": "bench",
    "x-hccna-os-name": "bench",
  };
}

let failuresLogged = 0;

/**
 * Sends one operation the way the app does and records whether it succeeded: HTTP 200, no GraphQL
 * `errors` and no FetchError / NotFoundError union result (classify.js). `tags` are added to the
 * request's metrics; setup passes none of the scenario tags so its requests stay out of the
 * per-operation numbers.
 */
export function send(operation, variables, token, tags) {
  // "phase" separates the load itself from setup requests in the overall numbers.
  const requestTags = tags.op === undefined ? tags : { ...tags, phase: "load" };
  const res = http.post(
    `${TARGET_URL}/graphql`,
    JSON.stringify({ query: operation.text, variables }),
    { headers: graphqlHeaders(token), tags: requestTags, timeout: "30s" },
  );
  const body = res.body === null ? "" : String(res.body);
  const { ok, reason } = classifyResponse(res.status, body);
  if (tags.op !== undefined) {
    graphqlOk.add(ok, requestTags);
    responseChars.add(body.length, requestTags);
    responseGzip.add(res.headers["Content-Encoding"] === "gzip", requestTags);
  }
  if (!ok && failuresLogged < 3) {
    failuresLogged += 1;
    // Reason, status and the start of the body only: errors carry no user data here.
    console.warn(`${operation.name} failed (${reason}): HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return { res, body, ok };
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (_error) {
    return null;
  }
}

/** Fails fast, with a pointer to the runbook, when the target cannot be reached or is not ready. */
export function assertTargetReady() {
  requireEnv("TARGET_URL", TARGET_URL);
  assertAllowedUrl(TARGET_URL, "TARGET_URL");
  if (TARGET_METRICS_URL) assertAllowedUrl(TARGET_METRICS_URL, "TARGET_METRICS_URL");
  const res = http.get(`${TARGET_URL}/readyz`, { tags: { setup_op: "readyz" }, timeout: "10s" });
  if (res.status !== 200) {
    fail(
      `${TARGET_URL}/readyz answered ${res.status === 0 ? `no response (${res.error})` : res.status}. ` +
        "Check the service is up and, over *.railway.internal, the private-networking note in RUNBOOK.md.",
    );
  }
}

/**
 * Anonymous Firebase sign-ups. Each call creates one anonymous account in the Firebase project the
 * key belongs to, as the mobile app does on first launch.
 */
export function signUp(count) {
  const key = requireEnv("FIREBASE_WEB_API_KEY", __ENV.FIREBASE_WEB_API_KEY);
  const tokens = [];
  for (let i = 0; i < count; i += 1) {
    // The key travels in a header, so no URL k6 logs or tags ever contains it.
    const res = http.post(
      `${IDENTITY_TOOLKIT_URL}/v1/accounts:signUp`,
      JSON.stringify({ returnSecureToken: true }),
      {
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        tags: { setup_op: "signUp" },
        timeout: "15s",
      },
    );
    const idToken = res.status === 200 ? parseJson(String(res.body))?.idToken : undefined;
    if (!idToken) {
      fail(`anonymous sign-up failed: HTTP ${res.status} ${String(res.body).slice(0, 200)}`);
    }
    tokens.push(idToken);
  }
  return tokens;
}

/**
 * One request per operation with fixed variables, in the order of operations.json. Variables come
 * from discovery: the first campus, and the first event with the campus it was listed under.
 */
export function fixedPlan(found) {
  const campus = found.campuses[0];
  const pair = found.eventPairs[0];
  const plan = [];
  for (const name of OPERATIONS.keys()) {
    if (name === "CampusesQuery") {
      plan.push({ name, variables: { preferredCampus: campus } });
    } else if (name === "LatestEventsQuery") {
      plan.push({ name, variables: { campusSlug: pair === undefined ? campus : pair.campusSlug } });
    } else if (name === "EventDetailQuery") {
      // A target with no upcoming events has nothing to open.
      if (pair !== undefined) {
        plan.push({ name, variables: { slug: pair.slug, campusSlug: pair.campusSlug } });
      }
    } else if (name === "SermonsItemsRefetchQuery") {
      plan.push({ name, variables: { count: 10, cursor: null } });
    } else {
      plan.push({ name, variables: {} });
    }
  }
  return plan;
}

/** Reads the target's own responses to find slugs and cursors; nothing is recorded in the repo. */
export function discover(token, { cursorLimit }) {
  const timings = [];
  const call = (name, variables) => {
    const { res, body, ok } = send(OPERATIONS.get(name), variables, token, { setup_op: name });
    timings.push({
      operation: name,
      status: res.status,
      ms: Math.round(res.timings.duration * 1000) / 1000,
      chars: body.length,
    });
    if (!ok) {
      fail(`discovery request ${name} failed (HTTP ${res.status}); see the warning above`);
    }
    return parseJson(body);
  };

  const campuses = campusSlugs(call("CampusesQuery", { preferredCampus: null }));
  if (campuses.length === 0) {
    fail("discovery found no campuses: the target has no CMS data to benchmark");
  }

  const eventPairs = [];
  for (const campusSlug of campuses.slice(0, 5)) {
    const slugs = upcomingEventSlugs(call("LatestEventsQuery", { campusSlug }));
    for (const slug of slugs.slice(0, 3)) {
      eventPairs.push({ slug, campusSlug });
    }
  }

  const cursors = [];
  if (cursorLimit > 0) {
    let after = null;
    while (cursors.length < cursorLimit) {
      const page = sermonPage(call("SermonsItemsRefetchQuery", { count: 50, cursor: after }));
      cursors.push(...page.cursors);
      if (!page.hasNextPage || page.endCursor === null || page.cursors.length === 0) break;
      after = page.endCursor;
    }
  }

  return { campuses, eventPairs, cursors: cursors.slice(0, cursorLimit), timings };
}

/** One GET of <TARGET_METRICS_URL>/metrics reduced to the numbers we compare; null on failure. */
export function scrapeMetrics() {
  if (!TARGET_METRICS_URL) return { error: "TARGET_METRICS_URL not set" };
  const res = http.get(`${TARGET_METRICS_URL}/metrics`, {
    tags: { setup_op: "metrics" },
    timeout: "15s",
  });
  if (res.status !== 200) {
    return { error: `GET /metrics answered ${res.status === 0 ? res.error : res.status}` };
  }
  return { snapshot: snapshot(String(res.body), Date.now()) };
}

/**
 * Everything setup() does. `scrape` is "start" (before discovery, so first-touch work is in the
 * server deltas and `fresh` can be judged) or "end" (after priming, so only the measured load is).
 * `validate(found)` may call fail() to stop before any priming or load.
 */
export function prepare({ tokenCount, cursorLimit, scrape, prime, validate }) {
  assertTargetReady();
  const startedAt = Date.now();
  let before = scrape === "start" ? scrapeMetrics() : null;
  // A restarted target has served no GraphQL request yet. Only meaningful for a "start" scrape.
  let fresh = null;
  if (before !== null && before.snapshot !== undefined) {
    fresh = before.snapshot.http === null || before.snapshot.http.count === 0;
    if (!fresh) {
      console.warn("target had already served GraphQL requests: restart it before a cold run");
    }
  }
  const tokens = signUp(tokenCount);
  const found = discover(tokens[0], { cursorLimit });
  if (validate !== undefined) validate(found);
  if (prime !== undefined) {
    prime(found, tokens);
  }
  if (before === null) before = scrapeMetrics();
  if (before.error) console.warn(`metrics before: ${before.error}`);
  // Operations a target with no upcoming events cannot be asked about.
  const skipped = found.eventPairs.length === 0 ? ["EventDetailQuery"] : [];
  if (skipped.length > 0) console.warn(`skipping ${skipped.join(", ")}: no upcoming events found`);
  return {
    startedAt,
    // The load starts as setup() returns; per-step windows are offsets from here.
    readyAt: Date.now(),
    tokens,
    found,
    before,
    fresh,
    skipped,
  };
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function values(data, name) {
  return data.metrics[name]?.values;
}

function latency(trend) {
  if (trend === undefined || trend.count === 0) return null;
  return {
    avg: round(trend.avg),
    min: round(trend.min),
    p50: round(trend.med),
    p90: round(trend["p(90)"]),
    p95: round(trend["p(95)"]),
    p99: round(trend["p(99)"]),
    max: round(trend.max),
  };
}

function slice(data, selector) {
  const trend = values(data, `http_req_duration${selector}`);
  return {
    requests: trend === undefined ? 0 : trend.count,
    failedRate: round(values(data, `http_req_failed${selector}`)?.rate ?? 0, 5),
    graphqlOkRate: round(values(data, `graphql_ok${selector}`)?.rate ?? 0, 5),
    latencyMs: latency(trend),
    responseCharsAvg: round(values(data, `response_chars${selector}`)?.avg ?? 0, 0),
  };
}

/**
 * The end-of-test report, as JSON Lines on stdout (Railway truncates very long log lines, so one
 * object per line, each with a "type"). A readable table goes to stderr.
 *
 * k6 does not hand teardown() state to handleSummary(), so the "after" metrics scrape happens
 * here instead; it follows the last request by well under a second.
 *
 * `meta`: {scenario, config, slices: [{type, name, selector, offsetSeconds?, durationSeconds?}],
 * requireFresh?}. A slice with offsetSeconds is a scenario step; its start and end times are
 * derived from when setup() returned.
 */
export function summarize(data, meta) {
  const setup = data.setup_data;
  if (setup === undefined || setup === null) {
    // setup() failed (unreachable target, sign-up rejected, no CMS data); k6 logged why.
    const failure = { type: "error", scenario: meta.scenario, target: TARGET_NAME };
    failure.message = "setup failed before any load was sent; see the k6 error above";
    return { stdout: `${JSON.stringify(failure)}\n` };
  }
  const test = (name) => values(data, name);
  const endedAt = Date.now();

  let server;
  if (setup.before.error) {
    server = { error: `before: ${setup.before.error}` };
  } else {
    const after = scrapeMetrics();
    server = after.error
      ? { error: `after: ${after.error}` }
      : { target: TARGET_NAME, ...deltas(setup.before.snapshot, after.snapshot) };
  }

  const iterations = test("iterations")?.count ?? 0;
  const dropped = test("dropped_iterations")?.count ?? 0;
  const overall = slice(data, "{phase:load}");
  const okRate = test("graphql_ok{phase:load}")?.rate;

  // Reasons the numbers do not measure the target. Any of them makes the run invalid.
  const invalidReasons = [];
  if (dropped > 0) {
    invalidReasons.push(`${dropped} dropped iteration(s): the generator could not hold the arrival rate`);
  }
  if (overall.requests === 0) {
    invalidReasons.push("no load requests were made");
  } else if (okRate !== 1) {
    invalidReasons.push(
      `graphqlOkRate ${overall.graphqlOkRate} is below 1: HTTP errors, GraphQL errors or FetchError/NotFoundError results`,
    );
  }
  if (meta.requireFresh && setup.fresh === false) {
    invalidReasons.push("the target had served GraphQL requests before this cold run: flush Redis and restart it first");
  }
  if (server.counterReset) {
    invalidReasons.push("a server counter went backwards: the target restarted during the run");
  }

  const lines = [];
  lines.push({
    type: "run",
    scenario: meta.scenario,
    target: TARGET_NAME,
    targetUrl: TARGET_URL,
    // Setup (sign-up, discovery, priming) began here ...
    startedAt: new Date(setup.startedAt).toISOString(),
    // ... and the load itself ran between these two: use them for Railway CPU and memory windows.
    loadStartedAt: new Date(setup.readyAt).toISOString(),
    loadEndedAt: new Date(endedAt).toISOString(),
    testRunSeconds: round(data.state.testRunDurationMs / 1000, 1),
    config: meta.config,
    seed: SEED,
    iterations,
    droppedIterations: dropped,
    // False for a cold run against a server that had already served GraphQL; null when unknown.
    fresh: setup.fresh,
    valid: invalidReasons.length === 0,
    invalidReasons,
    vusMax: test("vus_max")?.max ?? null,
    dataReceivedBytes: test("data_received")?.count ?? null,
    overall,
    gzipRate: round(test("response_gzip")?.rate ?? 0, 4),
  });

  for (const entry of meta.slices) {
    const line = { type: entry.type, name: entry.name };
    if (entry.offsetSeconds !== undefined) {
      line.rate = entry.rate;
      line.startedAt = new Date(setup.readyAt + entry.offsetSeconds * 1000).toISOString();
      line.endedAt = new Date(
        setup.readyAt + (entry.offsetSeconds + entry.durationSeconds) * 1000,
      ).toISOString();
    }
    lines.push({ ...line, ...slice(data, entry.selector) });
  }

  lines.push({
    type: "setup",
    campuses: setup.found.campuses.length,
    eventPairs: setup.found.eventPairs.length,
    cursors: setup.found.cursors.length,
    tokens: setup.tokens.length,
    // Operations the scenario could not exercise on this target.
    skipped: setup.skipped,
    // First requests the scenario made itself: in a cold run these are the cold-start samples.
    discovery: setup.found.timings,
  });
  lines.push({ type: "server", ...server });

  const table = [`${meta.scenario} @ ${TARGET_NAME}: ${iterations} iterations, ${dropped} dropped`];
  if (invalidReasons.length > 0) {
    table.unshift(`INVALID RUN: ${invalidReasons.join("; ")}`);
  }
  if (setup.skipped.length > 0) {
    table.push(`  skipped (no data on this target): ${setup.skipped.join(", ")}`);
  }
  for (const line of lines) {
    if (line.latencyMs) {
      const l = line.latencyMs;
      table.push(
        `  ${line.type} ${line.name}: n=${line.requests} p50=${l.p50} p95=${l.p95} p99=${l.p99} max=${l.max} ms, failed=${line.failedRate}, ok=${line.graphqlOkRate}`,
      );
    }
  }
  return {
    stdout: `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    stderr: `${table.join("\n")}\n`,
  };
}

/** Deterministic global iteration number within the running scenario. */
export function iteration() {
  return exec.scenario.iterationInTest;
}

/** Fails at init when a scenario would outlive the Firebase tokens it signs up with. */
export function assertShortEnough(seconds) {
  if (seconds > MAX_SCENARIO_MINUTES * 60) {
    throw new Error(
      `scenario lasts ${Math.round(seconds / 60)} minutes; tokens last an hour (limit ${MAX_SCENARIO_MINUTES})`,
    );
  }
}
