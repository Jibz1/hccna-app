import { useIsFocused } from "expo-router";
import { useState } from "react";
import { type LayoutChangeEvent, useWindowDimensions } from "react-native";
import {
  type SharedValue,
  useAnimatedReaction,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useIsAppActive } from "@/hooks/useIsAppActive";

/** Attach onLayout to the hero's direct child of the scrolling content. */
export function useCarouselAutoplay(scrollY?: SharedValue<number>) {
  const isFocused = useIsFocused();
  const appIsActive = useIsAppActive();
  const reduceMotion = useReducedMotion();
  const { height: viewportHeight } = useWindowDimensions();
  const bounds = useSharedValue<{ top: number; bottom: number } | null>(null);
  const [isVisible, setIsVisible] = useState(scrollY === undefined);

  useAnimatedReaction(
    () => {
      if (!scrollY) {
        return true;
      }
      const layout = bounds.get();
      const offset = scrollY.get();
      return (
        layout !== null &&
        layout.bottom > offset &&
        layout.top < offset + viewportHeight
      );
    },
    (visible, previous) => {
      // Cross to React only when visibility changes, never on every scroll frame.
      if (visible !== previous) {
        scheduleOnRN(setIsVisible, visible);
      }
    },
  );

  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    bounds.set({ top: layout.y, bottom: layout.y + layout.height });
  };

  return {
    autoplay: isFocused && appIsActive && isVisible && !reduceMotion,
    onLayout,
  };
}
