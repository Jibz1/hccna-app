// Refuses targets that must never take benchmark load: the live TS service, production's public
// domains and the production Redis. Pure (no k6 imports) so lib.js, diff.ts and redis-stats.ts
// share one rule and Bun can test it.

const DENIED_DOMAINS = [
  ["hccnj.org", "a production domain (api.hccnj.org and the website)"],
];

// Compared with the first DNS label of the host.
const DENIED_LABELS = [
  ["hccna-backend", "the live hccna-backend service"],
  ["hccna-backend-production", "the live hccna-backend service (public Railway domain)"],
];

// Any host whose first label starts with this is production Redis. hccna-bench-redis does not.
const DENIED_LABEL_PREFIXES = [["hccna-redis", "the production Redis (hccna-redis)"]];

/** The lower-cased host of a URL, without port or credentials; null when it is not a URL. */
export function hostOf(url) {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(String(url).trim());
  return match === null ? null : match[1].toLowerCase().replace(/\.$/, "");
}

/** Why `url` must not be used, or null when it is allowed. */
export function deniedReason(url) {
  const host = hostOf(url);
  if (host === null || host === "") return "it is not a URL with a scheme and a host";
  const label = host.split(".")[0];
  for (const [domain, why] of DENIED_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return why;
  }
  for (const [denied, why] of DENIED_LABELS) {
    if (label === denied) return why;
  }
  for (const [prefix, why] of DENIED_LABEL_PREFIXES) {
    if (label.startsWith(prefix)) return why;
  }
  return null;
}

/** Throws unless `url` is safe to send benchmark traffic to. `name` is the variable it came from. */
export function assertAllowedUrl(url, name) {
  const reason = deniedReason(url);
  if (reason !== null) {
    throw new Error(
      `${name} is refused: ${reason}. The benchmark only targets hccna-backend-rs, ` +
        "hccna-backend-ts-bench and hccna-bench-redis (apps/server-rs/bench/RUNBOOK.md).",
    );
  }
}
