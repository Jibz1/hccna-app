import { useState } from "react";
import { useWindowDimensions } from "react-native";
import { type SharedValue, useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/** Bounds are in scroll-content coordinates, including any visual overflow. */
export function useViewportVisibility(
  scrollY: SharedValue<number>,
  bounds: { top: number; bottom: number } | null,
) {
  const { height: viewportHeight } = useWindowDimensions();
  const [isVisible, setIsVisible] = useState(false);
  const top = bounds?.top;
  const bottom = bounds?.bottom;

  useAnimatedReaction(
    () => {
      const offset = scrollY.get();
      return (
        top !== undefined &&
        bottom !== undefined &&
        bottom > offset &&
        top < offset + viewportHeight
      );
    },
    (visible, previous) => {
      // Scrolling stays on the UI thread; notify React only at the boundary.
      if (visible !== previous) {
        scheduleOnRN(setIsVisible, visible);
      }
    },
  );

  return isVisible;
}
