const TRUSTED_BACKEND_DOMAIN = "hccnj.org";
// The hccna service's Stellate edge cache, which forwards cache misses to the backend.
const TRUSTED_EDGE_HOSTNAME = "hccna.stellate.sh";

export function resolveTrustedAppsBackendUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const isTrustedHostname =
      url.hostname === TRUSTED_BACKEND_DOMAIN ||
      url.hostname.endsWith(`.${TRUSTED_BACKEND_DOMAIN}`) ||
      url.hostname === TRUSTED_EDGE_HOSTNAME;

    if (
      url.protocol !== "https:" ||
      !isTrustedHostname ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}
