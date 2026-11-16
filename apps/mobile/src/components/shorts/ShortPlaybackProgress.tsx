import { useEffect, useState, type RefObject } from "react";
import { View } from "react-native";
import type { YoutubeIframeRef } from "react-native-youtube-iframe";

import { useAppTheme } from "@/theme/useAppTheme";

const TICK_MS = 500;
/** The player library's readings never reject or time out by themselves. */
const READING_TIMEOUT_MS = 2_000;

/** The reading, or nothing if it fails or goes unanswered. */
function reading(read: () => Promise<number>): Promise<number | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(undefined);
    }, READING_TIMEOUT_MS);
    const finish = (value: number | undefined) => {
      clearTimeout(timer);
      resolve(value);
    };
    try {
      read().then(finish, () => {
        finish(undefined);
      });
    } catch {
      finish(undefined);
    }
  });
}

/** Isolates playback ticks from the player and the rest of the feed. */
export function ShortPlaybackProgress({
  playerRef,
  running,
  bottom,
}: {
  playerRef: RefObject<YoutubeIframeRef | null>;
  running: boolean;
  bottom: number;
}) {
  const { colors } = useAppTheme();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!running) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // A short's length does not change, so it is read until known, then kept.
    let duration = 0;

    // A missing reading must neither interrupt the video nor end the ticks.
    async function update() {
      const player = playerRef.current;
      if (player) {
        if (duration <= 0) {
          duration = (await reading(() => player.getDuration())) ?? 0;
        }
        const current = await reading(() => player.getCurrentTime());
        if (
          !cancelled &&
          current !== undefined &&
          Number.isFinite(current) &&
          duration > 0
        ) {
          setProgress(Math.max(0, Math.min(1, current / duration)));
        }
      }
      if (!cancelled) {
        timer = setTimeout(() => {
          void update();
        }, TICK_MS);
      }
    }

    void update();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [playerRef, running]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Video progress"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      pointerEvents="none"
      style={{ bottom }}
      className="absolute right-6 left-6 z-1 h-0.5 overflow-hidden rounded-full bg-white/25"
    >
      <View
        style={{ width: `${progress * 100}%`, backgroundColor: colors.onImage }}
        className="h-full rounded-full"
      />
    </View>
  );
}
