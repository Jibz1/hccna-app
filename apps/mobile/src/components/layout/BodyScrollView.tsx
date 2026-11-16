"use client";

import { useRef, type Ref } from "react";
import { Platform, ScrollViewProps } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StyledAnimatedScrollView } from "@/cssInterop";
import { useScrollToTop } from "@/hooks/navigation/useTabToTop";
import { composeRefs } from "@/utils/composeRefs";

// import { useBottomTabOverflow } from "../navigation/TabBarBackground";

type AnimatedScrollViewInstance = Animated.ScrollView;

export function BodyScrollView({
  ref,
  ...props
}: ScrollViewProps & { ref?: Ref<AnimatedScrollViewInstance> }) {
  const paddingBottom = 10;

  const { bottom } = useSafeAreaInsets();

  const internalRef = useRef<AnimatedScrollViewInstance>(null);
  const combinedRef = composeRefs(ref, internalRef);

  useScrollToTop(internalRef);

  return (
    <StyledAnimatedScrollView
      ref={combinedRef}
      scrollToOverflowEnabled
      automaticallyAdjustsScrollIndicatorInsets
      // Safe-area top inset is handled by parent layouts (tab headers, modal headers).
      // "never" prevents double-inset issues when parents already account for safe areas.
      contentInsetAdjustmentBehavior="never"
      contentInset={{ bottom: paddingBottom }}
      scrollIndicatorInsets={{
        bottom: paddingBottom - (Platform.OS === "ios" ? bottom : 0),
      }}
      {...props}
    />
  );
}
