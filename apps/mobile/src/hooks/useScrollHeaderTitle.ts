import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

export function useScrollHeaderTitle() {
  const scrollY = useSharedValue(0);
  const contentTop = useSharedValue(0);
  const titleBottom = useSharedValue<number | null>(null);
  const [showHeaderTitle, setShowHeaderTitle] = useState(false);

  useAnimatedReaction(
    () => {
      const bottom = titleBottom.get();
      return bottom !== null && scrollY.get() >= contentTop.get() + bottom;
    },
    (visible, previous) => {
      // Keep scrolling on the UI thread; update React only at the title boundary.
      if (visible !== previous) {
        scheduleOnRN(setShowHeaderTitle, visible);
      }
    },
  );

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  // Measure the content wrapper to include any ScrollView top padding.
  const onContentLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    contentTop.set(layout.y);
  };
  // The title's ancestors must start at the content wrapper's vertical origin.
  const onTitleLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    titleBottom.set(layout.y + layout.height);
  };

  return { showHeaderTitle, onScroll, onTitleLayout, onContentLayout };
}
