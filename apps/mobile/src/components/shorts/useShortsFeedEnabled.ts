import { FEATURE_GATES } from "@/featureGates/names";
import { useGate } from "@/featureGates/react";

/**
 * The Shorts side of the Sermons tab. While the gate is off (or missing), the
 * tab has no switch and looks exactly as it did before Shorts existed, so the
 * update can ship ahead of the server and the YouTube key.
 */
export const SHORTS_FEED_GATE = FEATURE_GATES.shortsFeed;

export function useShortsFeedEnabled(): boolean {
  return useGate(SHORTS_FEED_GATE);
}
