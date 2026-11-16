// resolver: varied variables defeat the response cache, so every request runs authentication
// (one Firebase revocation lookup each), query execution, the record caches and the JSON
// transforms. Capped at 20 requests per second because each cache miss costs a lookup against
// Firebase, and Postgres, Strapi and Firebase are shared with production.
//
// What varies per request, and why:
//  - SermonsItemsRefetchQuery (45%): $count 1..50 and a real discovered cursor. Every
//    (count, cursor) pair is used at most once per run, so each request misses the response
//    cache, and each is a distinct Strapi query, so each misses the record cache too. These are
//    the only requests expected to reach Strapi: about 45% of all requests.
//  - CampusesQuery (35%): a unique $preferredCampus. The server only uses it to order the list, so
//    the response-cache key is new each time while the Strapi record cache still serves the data.
//    Expected Strapi calls: none after the first.
//  - LatestEventsQuery / EventDetailQuery (10% each): discovered campus and event slugs.
//    upcomingEventsByMonth is cached per Authorization value, so TOKEN_COUNT distinct tokens
//    (default 4) give TOKEN_COUNT x campuses separate keys; only the first request for each key
//    misses.
// Operations without variables (core, thoughtOfGod, ccbFormsV2, verseOfTheDayV2) cannot be
// varied; their resolver paths are measured by the cold scenario.
//
// The request sequence is a pure function of SEED and the discovered data, so two targets receive
// the same one. Nothing in it depends on the clock; change SEED for an independent sequence and
// use the same SEED on both targets.

import {
  OPERATIONS,
  SEED,
  assertShortEnough,
  baseOptions,
  cappedRate,
  iteration,
  positiveInt,
  prepare,
  send,
  summarize,
  summaryThresholds,
} from "./lib.js";
import { permutedIndex, pickWeighted, rngFor } from "./discovery.js";
import { fail } from "k6";

const MAX_RPS = 20;
const RATE = cappedRate(__ENV.RATE, MAX_RPS, MAX_RPS);
const DURATION_SECONDS = positiveInt(__ENV.DURATION_SECONDS, 300);
const TOKEN_COUNT = positiveInt(__ENV.TOKEN_COUNT, 4);
const CURSOR_LIMIT = positiveInt(__ENV.CURSOR_LIMIT, 200);
const MAX_COUNT = 50;
assertShortEnough(DURATION_SECONDS);

const SERMONS = "SermonsItemsRefetchQuery";

// Share of requests per operation.
const MIX = [
  [SERMONS, 45],
  ["CampusesQuery", 35],
  ["LatestEventsQuery", 10],
  ["EventDetailQuery", 10],
];

/** The mix for a target: with no upcoming events there is nothing to open. */
function mixFor(found) {
  return found.eventPairs.length === 0 ? MIX.filter(([name]) => name !== "EventDetailQuery") : MIX;
}

/** (count, cursor) pairs available to the sermon requests; null is the first page. */
function sermonCombinations(found) {
  return (found.cursors.length + 1) * MAX_COUNT;
}

/**
 * Sermon requests the run will make, by the mix. The expected Strapi share of the run is the same
 * number as a fraction of all requests.
 */
function plannedSermonRequests(found) {
  const mix = mixFor(found);
  const total = mix.reduce((sum, [, weight]) => sum + weight, 0);
  return Math.ceil((RATE * DURATION_SECONDS * SERMON_WEIGHT) / total);
}

/**
 * How many sermon requests precede iteration `i`. Each sermon request takes the next unused
 * (count, cursor) pair, so none repeats until every pair has been used. Computed by replaying the
 * seeded draws, which every VU can do identically; the table is kept per VU.
 */
const sermonsBefore = [0];
function sermonOrdinal(i, mix) {
  for (let j = sermonsBefore.length - 1; j < i; j += 1) {
    const kind = pickWeighted(rngFor(SEED, j)(), mix);
    sermonsBefore.push(sermonsBefore[j] + (kind === SERMONS ? 1 : 0));
  }
  return sermonsBefore[i];
}

const SERMON_WEIGHT = MIX[0][1];

const slices = MIX.map(([name]) => ({ type: "operation", name, selector: `{op:${name}}` }));

export const options = {
  ...baseOptions,
  scenarios: {
    resolver: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: `${DURATION_SECONDS}s`,
      preAllocatedVUs: 10,
      maxVUs: 100,
      gracefulStop: "10s",
    },
  },
  thresholds: summaryThresholds(slices.map((slice) => slice.selector.slice(1, -1))),
};

export function setup() {
  return prepare({
    tokenCount: TOKEN_COUNT,
    cursorLimit: CURSOR_LIMIT,
    scrape: "end",
    // Reusing a (count, cursor) pair would be a response-cache hit and quietly change what the
    // scenario measures, so refuse a run the discovered data cannot cover.
    validate(found) {
      const combinations = sermonCombinations(found);
      const planned = plannedSermonRequests(found);
      if (combinations < planned) {
        fail(
          `the run plans ${planned} sermon requests but only ${combinations} distinct ` +
            `(count, cursor) pairs exist (${found.cursors.length} cursors discovered); ` +
            "lower RATE or DURATION_SECONDS, or raise CURSOR_LIMIT",
        );
      }
    },
  });
}

export default function (data) {
  const i = iteration();
  const rng = rngFor(SEED, i);
  const { campuses, eventPairs, cursors } = data.found;
  const token = data.tokens[i % data.tokens.length];

  const mix = mixFor(data.found);
  const name = pickWeighted(rng(), mix);
  let variables;
  if (name === SERMONS) {
    // null stands for the first page.
    const pool = [null, ...cursors];
    const combo = permutedIndex(sermonOrdinal(i, mix), pool.length * MAX_COUNT, SEED);
    variables = { count: 1 + (combo % MAX_COUNT), cursor: pool[Math.floor(combo / MAX_COUNT)] };
  } else if (name === "CampusesQuery") {
    variables = { preferredCampus: `bench-${SEED}-${i}` };
  } else if (name === "LatestEventsQuery") {
    variables = { campusSlug: campuses[Math.floor(rng() * campuses.length)] };
  } else {
    const pair = eventPairs[Math.floor(rng() * eventPairs.length)];
    variables = { slug: pair.slug, campusSlug: pair.campusSlug };
  }
  send(OPERATIONS.get(name), variables, token, { op: name });
}

export function handleSummary(data) {
  return summarize(data, {
    scenario: "resolver",
    config: { rate: RATE, durationSeconds: DURATION_SECONDS, tokenCount: TOKEN_COUNT, mix: MIX },
    slices,
  });
}
