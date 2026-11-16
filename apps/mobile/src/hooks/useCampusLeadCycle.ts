import { useEffect, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { useCarouselAutoplay } from "@/hooks/useCarouselAutoplay";

/** How long each card shows a lead before changing to the next. */
export const CAMPUS_LEAD_INTERVAL_MS = 30_000;
/** How much later each cycling card changes than the one before it. */
export const CAMPUS_LEAD_STAGGER_MS = 500;

/**
 * "playing" while Home is focused and the app is active (tabs are not frozen on blur),
 * "paused" otherwise so cards hold their name, and "still" when motion is reduced: cards then
 * list every lead at once.
 */
export type CampusLeadPlayback = "playing" | "paused" | "still";

export function useCampusLeadPlayback(): CampusLeadPlayback {
  const { autoplay } = useCarouselAutoplay();
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return "still";
  }
  return autoplay ? "playing" : "paused";
}

/**
 * Which of a card's leads to show. Card `order` (among the cards that cycle) first changes
 * `order + 1` staggers after playback starts, then every interval, so the cards change one after
 * another. Idle between changes.
 */
export function useCampusLeadIndex(
  leadCount: number,
  order: number,
  playing: boolean,
) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!playing || leadCount < 2) {
      return;
    }
    let interval: ReturnType<typeof setInterval> | undefined;
    const advance = () => {
      setStep((value) => value + 1);
    };
    const start = setTimeout(
      () => {
        advance();
        interval = setInterval(advance, CAMPUS_LEAD_INTERVAL_MS);
      },
      (order + 1) * CAMPUS_LEAD_STAGGER_MS,
    );
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [playing, leadCount, order]);

  return leadCount < 2 ? 0 : step % leadCount;
}
