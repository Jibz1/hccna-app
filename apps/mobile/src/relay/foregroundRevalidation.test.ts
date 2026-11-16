import { expect, test, vi } from "vitest";

import {
  ForegroundRevalidator,
  parseRevalidationConfig,
} from "@/relay/foregroundRevalidation";
import { DEFAULT_OFFLINE_QUERY_RETENTION_ALLOWLIST } from "@/relay/offlineQueryRetention";

const MINUTE_MS = 60 * 1_000;
const NOW = Date.UTC(2026, 0, 4, 12);

function sweepSermonsFetched(minutesAgo: number) {
  const executeFetch = vi.fn(() => Promise.resolve());
  const revalidator = new ForegroundRevalidator({
    allowlist: DEFAULT_OFFLINE_QUERY_RETENTION_ALLOWLIST,
    executeFetch,
    fetchStartDelayMs: 0,
    generationStorage: { getString: () => undefined, set: () => undefined },
    getConfig: () => parseRevalidationConfig(undefined),
    getConnectivityStatus: () => "online",
    now: () => NOW,
  });
  revalidator.seedFromManifestEntries([
    {
      operationName: "SermonsContainerQuery",
      variables: {},
      authScope: "anon",
      lastAccessedAt: NOW - minutesAgo * MINUTE_MS,
      expiresAt: NOW,
    },
  ]);
  return revalidator.sweep("foregrounded").then(() => executeFetch);
}

// Revalidating sermons refetches only the first page, which drops the pages a
// listener scrolled through, so a quick trip to the video player must keep them.
test("keeps scrolled sermons through a short trip away from the app", async () => {
  expect(await sweepSermonsFetched(10)).not.toHaveBeenCalled();
});

test("refreshes sermons after the app was away for hours", async () => {
  expect(await sweepSermonsFetched(120)).toHaveBeenCalledTimes(1);
});
