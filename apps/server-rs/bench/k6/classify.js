// What counts as a successful GraphQL response. Pure, shared by lib.js and diff.ts.
//
// The schema reports expected failures as union members instead of GraphQL errors
// (CampusesFetchError, VodNotFoundError, CCBFormsFetchError, ...), always with HTTP 200 and no
// `errors`. For a benchmark those are failures too: the server did not do the work being measured.

const TYPED_ERROR = /"__typename"\s*:\s*"([A-Za-z0-9_]*(?:FetchError|NotFoundError))"/;
const GRAPHQL_ERRORS = /"errors"\s*:/;

/** The `__typename` of the first FetchError / NotFoundError result in `body`, or null. */
export function typedErrorIn(body) {
  const match = TYPED_ERROR.exec(body);
  return match === null ? null : match[1];
}

/** True when the body carries a top-level GraphQL `errors` key. */
export function hasGraphqlErrors(body) {
  return GRAPHQL_ERRORS.test(body);
}

/**
 * @returns {{ok: boolean, reason: string | null}} `reason` is `http-<status>`, `graphql-errors`
 * or `typed-error:<__typename>` when `ok` is false.
 */
export function classifyResponse(status, body) {
  if (status !== 200) return { ok: false, reason: `http-${status}` };
  if (hasGraphqlErrors(body)) return { ok: false, reason: "graphql-errors" };
  const typed = typedErrorIn(body);
  if (typed !== null) return { ok: false, reason: `typed-error:${typed}` };
  return { ok: true, reason: null };
}
