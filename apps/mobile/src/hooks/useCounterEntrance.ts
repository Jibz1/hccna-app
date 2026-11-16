import { use } from "react";
import { useWindowDimensions, type View } from "react-native";
import {
  measure,
  useAnimatedReaction,
  useAnimatedRef,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { ScrollOffsetContext } from "@/components/layout/ScrollOffsetContext";

/** Observe an unseen amount; the owner unmounts this observer after entrance. */
export function useCounterEntrance(onEnter: () => void) {
  const ref = useAnimatedRef<View>();
  const scrollY = use(ScrollOffsetContext);
  const layoutVersion = useSharedValue(0);
  const hasNotified = useSharedValue(false);
  const { height } = useWindowDimensions();
  const { top, bottom } = useSafeAreaInsets();

  useAnimatedReaction(
    () => {
      if (layoutVersion.get() === 0) {
        return false;
      }
      // The parent scroll offset triggers remeasurement of nested amount views.
      scrollY?.get();
      const bounds = measure(ref);
      return (
        bounds !== null &&
        bounds.height > 0 &&
        bounds.pageY >= top &&
        bounds.pageY + bounds.height <= height - bottom
      );
    },
    (visible, previouslyVisible) => {
      if (visible && !previouslyVisible && !hasNotified.get()) {
        // Claim the entrance on the UI thread before the asynchronous JS handoff.
        hasNotified.set(true);
        scheduleOnRN(onEnter);
      }
    },
  );

  const onLayout = () => {
    layoutVersion.set((version) => version + 1);
  };

  return { ref, onLayout };
}
