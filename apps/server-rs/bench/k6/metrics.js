// Prometheus text parsing and snapshot arithmetic for the harness. Pure functions with no k6
// imports, so Bun can unit-test them (metrics.test.ts) and k6 can import them.
//
// Both servers answer GET /metrics on their metrics port, but not identically:
//
//  - The Rust server (src/metrics.rs) has one registry. Counters carry a `_total` suffix and the
//    `process_*` collector is present on Linux.
//  - The TS server (src/app.ts, metricsApp) prints two registries back to back: prom-client
//    (counters WITHOUT `_total`, e.g. `service_request`) and the Effect/OTel reader (counters WITH
//    `_total`, histograms under the same names). The same histogram family can therefore appear
//    twice. It has no `process_*` metrics at all (default collection is off).
//
// So families are keyed with a trailing `_total` removed and the FIRST block of a family wins;
// the second block (the OTel copy, with extra client labels) is ignored rather than double counted.

const LABEL_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

/** @param {string} line */
function parseSample(line) {
  const brace = line.indexOf("{");
  let name;
  let rest;
  const labels = {};
  if (brace === -1) {
    const space = line.indexOf(" ");
    if (space === -1) return null;
    name = line.slice(0, space);
    rest = line.slice(space + 1);
  } else {
    const close = line.lastIndexOf("}");
    if (close === -1) return null;
    name = line.slice(0, brace);
    const text = line.slice(brace + 1, close);
    LABEL_PATTERN.lastIndex = 0;
    let match = LABEL_PATTERN.exec(text);
    while (match !== null) {
      labels[match[1]] = match[2];
      match = LABEL_PATTERN.exec(text);
    }
    rest = line.slice(close + 1).trim();
  }
  const value = Number(rest.trim().split(/\s+/)[0]);
  return Number.isNaN(value) ? null : { name, labels, value };
}

/**
 * Groups samples by metric family.
 * @param {string} text Prometheus text exposition.
 * @returns {Map<string, {type: string, samples: {name: string, labels: Record<string, string>, value: number}[]}>}
 */
export function parseExposition(text) {
  const families = new Map();
  const seen = new Set();
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("# TYPE ")) {
      const [, , name, type] = line.split(/\s+/);
      const key = name.replace(/_total$/, "");
      if (seen.has(key)) {
        current = null;
      } else {
        seen.add(key);
        current = { key, name };
        families.set(key, { type, samples: [] });
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    if (current === null) continue;
    const sample = parseSample(line);
    if (
      sample !== null &&
      (sample.name === current.name || sample.name.startsWith(`${current.name}_`))
    ) {
      families.get(current.key).samples.push(sample);
    }
  }
  return families;
}

function family(families, name) {
  return families.get(name.replace(/_total$/, ""));
}

function leValue(text) {
  return text === "+Inf" ? Infinity : Number(text);
}

/** Sums `_bucket`, `_sum` and `_count` samples that pass `keep`, merging equal `le` bounds. */
function histogramTotals(fam, keep) {
  const buckets = new Map();
  let sum = 0;
  let count = 0;
  if (fam === undefined) return null;
  for (const sample of fam.samples) {
    if (!keep(sample.labels)) continue;
    if (sample.name.endsWith("_bucket")) {
      const le = leValue(sample.labels.le);
      buckets.set(le, (buckets.get(le) ?? 0) + sample.value);
    } else if (sample.name.endsWith("_sum")) {
      sum += sample.value;
    } else if (sample.name.endsWith("_count")) {
      count += sample.value;
    }
  }
  return {
    count,
    sum,
    // Bounds stay text ("0.005", "+Inf") because JSON, and so k6's setup data, cannot hold Infinity.
    buckets: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([le, n]) => [textOf(le), n]),
  };
}

function textOf(le) {
  return le === Infinity ? "+Inf" : String(le);
}

/** Per-label-value `_count` and `_sum` of a histogram. */
function histogramBy(fam, labelFor) {
  const result = {};
  if (fam === undefined) return result;
  for (const sample of fam.samples) {
    const key = labelFor(sample.labels);
    if (key === null) continue;
    result[key] ??= { count: 0, sum: 0 };
    if (sample.name.endsWith("_sum")) result[key].sum += sample.value;
    else if (sample.name.endsWith("_count")) result[key].count += sample.value;
  }
  return result;
}

function counterBy(fam, labelFor) {
  const result = {};
  if (fam === undefined) return result;
  for (const sample of fam.samples) {
    const key = labelFor(sample.labels);
    if (key === null) continue;
    result[key] = (result[key] ?? 0) + sample.value;
  }
  return result;
}

function gauge(families, name) {
  const fam = family(families, name);
  const sample = fam?.samples.find((s) => s.name === name);
  return sample === undefined ? null : sample.value;
}

/**
 * Reduces a /metrics body to the numbers the harness compares. JSON-serializable, so k6 can pass
 * it through setup().
 * @param {string} text
 * @param {number} at Epoch milliseconds when it was scraped.
 */
export function snapshot(text, at) {
  const families = parseExposition(text);
  const isGraphql = (labels) => labels.path_group === "/graphql";
  const services = {};
  const serviceKey = (labels) =>
    labels.service === undefined ? null : `${labels.service}/${labels.action ?? ""}`;
  const requests = counterBy(family(families, "service_request_total"), serviceKey);
  const errors = counterBy(family(families, "service_error_total"), serviceKey);
  const durations = histogramBy(family(families, "service_request_duration"), serviceKey);
  for (const key of new Set([...Object.keys(requests), ...Object.keys(durations)])) {
    services[key] = {
      count: requests[key] ?? durations[key]?.count ?? 0,
      errors: errors[key] ?? 0,
      sum: durations[key]?.sum ?? 0,
    };
  }
  const httpErrors = counterBy(family(families, "http_server_errors_total"), (labels) =>
    isGraphql(labels) ? "graphql" : null,
  );
  return {
    at,
    http: histogramTotals(family(families, "http_server_request_duration_seconds"), isGraphql),
    httpErrors: httpErrors.graphql ?? 0,
    operations: histogramBy(
      family(families, "graphql_envelop_request_duration"),
      (labels) => labels.operationName ?? null,
    ),
    services,
    process: {
      rssBytes: gauge(families, "process_resident_memory_bytes"),
      cpuSeconds: gauge(families, "process_cpu_seconds_total"),
      threads: gauge(families, "process_threads"),
      openFds: gauge(families, "process_open_fds"),
    },
  };
}

/**
 * Prometheus `histogram_quantile` over cumulative [upperBound, count] pairs sorted ascending
 * (the last bound is Infinity). Returns seconds, or null when there are no observations.
 */
export function histogramQuantile(q, buckets) {
  if (buckets.length === 0) return null;
  const total = buckets[buckets.length - 1][1];
  if (total <= 0) return null;
  const rank = q * total;
  const index = buckets.findIndex((bucket) => bucket[1] >= rank);
  if (index === -1) return null;
  const [upper, count] = buckets[index];
  if (upper === Infinity) {
    // Beyond the last finite bound: report that bound, as Prometheus does.
    return buckets.length >= 2 ? buckets[buckets.length - 2][0] : null;
  }
  const lower = index === 0 ? 0 : buckets[index - 1][0];
  const lowerCount = index === 0 ? 0 : buckets[index - 1][1];
  if (count === lowerCount) return upper;
  return lower + ((upper - lower) * (rank - lowerCount)) / (count - lowerCount);
}

function ms(seconds) {
  return seconds === null ? null : Math.round(seconds * 1e6) / 1e3;
}

function mean(sum, count) {
  return count > 0 ? ms(sum / count) : null;
}

/**
 * What the server did between two snapshots of the same process.
 * `counterReset` is true when a counter went backwards, which means the server restarted during
 * the run and the deltas are not meaningful.
 * @returns {object}
 */
export function deltas(before, after) {
  let counterReset = false;
  const sub = (a, b) => {
    const delta = a - b;
    if (delta < 0) counterReset = true;
    return delta;
  };

  const result = { seconds: (after.at - before.at) / 1000 };

  if (before.http && after.http) {
    const bounds = new Map(before.http.buckets);
    const merged = after.http.buckets.map(([le, count]) => [
      leValue(le),
      sub(count, bounds.get(le) ?? 0),
    ]);
    const count = sub(after.http.count, before.http.count);
    const sum = sub(after.http.sum, before.http.sum);
    result.graphql = {
      requests: count,
      meanMs: mean(sum, count),
      p50Ms: ms(histogramQuantile(0.5, merged)),
      p95Ms: ms(histogramQuantile(0.95, merged)),
      p99Ms: ms(histogramQuantile(0.99, merged)),
      errors5xx: sub(after.httpErrors, before.httpErrors),
    };
  }

  result.operations = {};
  for (const [name, now] of Object.entries(after.operations)) {
    const was = before.operations[name] ?? { count: 0, sum: 0 };
    const count = sub(now.count, was.count);
    if (count !== 0) {
      result.operations[name] = { requests: count, meanMs: mean(sub(now.sum, was.sum), count) };
    }
  }

  result.upstreams = {};
  for (const [name, now] of Object.entries(after.services)) {
    const was = before.services[name] ?? { count: 0, errors: 0, sum: 0 };
    const count = sub(now.count, was.count);
    const errors = sub(now.errors, was.errors);
    if (count !== 0 || errors !== 0) {
      result.upstreams[name] = {
        requests: count,
        errors,
        meanMs: mean(sub(now.sum, was.sum), count),
      };
    }
  }

  // TS counts upstream calls only for strapi-v5, ccb and castr; it has no Firebase, Postgres or
  // Firestore counters. Strapi is the one upstream both servers report, so sum it separately.
  result.strapiRequests = Object.entries(result.upstreams)
    .filter(([name]) => name.startsWith("strapi"))
    .reduce((total, [, upstream]) => total + upstream.requests, 0);

  const proc = after.process;
  result.process = {
    rssBytes: proc.rssBytes,
    rssBytesBefore: before.process.rssBytes,
    cpuSeconds:
      proc.cpuSeconds !== null && before.process.cpuSeconds !== null
        ? Math.round(sub(proc.cpuSeconds, before.process.cpuSeconds) * 1e3) / 1e3
        : null,
    threads: proc.threads,
    openFds: proc.openFds,
  };
  result.counterReset = counterReset;
  return result;
}
