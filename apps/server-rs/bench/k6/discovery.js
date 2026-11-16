// Run-time variable discovery and deterministic variation, shared by the k6 scenarios and diff.ts.
// Pure functions with no k6 imports. Nothing here knows any real value: slugs and cursors are read
// from the target's own responses, so no recorded data is committed.

/** @param {any} body A parsed GraphQL response. */
export function campusSlugs(body) {
  const campuses = body?.data?.campusesV2?.campuses;
  if (!Array.isArray(campuses)) return [];
  return campuses.map((campus) => campus?.slug).filter((slug) => typeof slug === "string" && slug);
}

/** Event slugs from a LatestEventsQuery response, in order, without repeats. */
export function upcomingEventSlugs(body) {
  const months = body?.data?.upcomingEventsByMonth?.months;
  if (!Array.isArray(months)) return [];
  const slugs = [];
  for (const month of months) {
    for (const event of month?.events ?? []) {
      if (typeof event?.slug === "string" && event.slug && !slugs.includes(event.slug)) {
        slugs.push(event.slug);
      }
    }
  }
  return slugs;
}

/** One page of a `sermons` connection: its cursors and where the next page starts. */
export function sermonPage(body) {
  const connection = body?.data?.sermons;
  const edges = Array.isArray(connection?.edges) ? connection.edges : [];
  return {
    cursors: edges.map((edge) => edge?.cursor).filter((cursor) => typeof cursor === "string"),
    endCursor: connection?.pageInfo?.endCursor ?? null,
    hasNextPage: connection?.pageInfo?.hasNextPage === true,
  };
}

/** A small, fast, seedable generator (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The generator for iteration `iteration` of a run seeded with `seed`. The same (seed, iteration)
 * always gives the same stream, so two targets receive the same request sequence.
 */
export function rngFor(seed, iteration) {
  return mulberry32(Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(iteration + 1, 0x85ebca6b));
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Maps consecutive iterations onto distinct values in [0, size): a full-cycle walk with a stride
 * coprime to `size`. Used to vary cache keys without repeating one until every combination has
 * been used.
 */
export function permutedIndex(iteration, size, seed) {
  if (size <= 1) return 0;
  let stride = 1 + ((Math.imul(seed >>> 0, 2654435761) >>> 0) % (size - 1));
  while (gcd(stride, size) !== 1) stride += 1;
  const offset = (Math.imul(seed >>> 0, 40503) >>> 0) % size;
  return (offset + stride * (iteration % size)) % size;
}

/** Picks a key from [[key, weight], ...] with a uniform draw in [0, 1). */
export function pickWeighted(draw, weights) {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let remaining = draw * total;
  for (const [key, weight] of weights) {
    remaining -= weight;
    if (remaining < 0) return key;
  }
  return weights[weights.length - 1][0];
}
