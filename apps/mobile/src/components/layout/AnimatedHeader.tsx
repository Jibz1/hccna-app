import { Predicate } from "effect";
import { type BlurViewProps } from "expo-blur";
import { type ReactNode, useRef, useState } from "react";
import {
  type HostInstance,
  Platform,
  ScrollViewProps,
  View,
} from "react-native";
import { type SharedValue } from "react-native-reanimated";
import Animated, {
  Extrapolation,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  useAnimatedScrollHandler,
  interpolate,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { LiveStream } from "@/components/live/LiveStream";
import {
  StyledBlurTargetView as BlurTargetView,
  StyledBlurView as BlurView,
} from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Header } from "@/ui/Header";
import { cn } from "@/utils/styling";

import { BodyScrollView } from "./BodyScrollView";
import { ScrollOffsetContext } from "./ScrollOffsetContext";
import type { useTabScreenLayout } from "./useTabScreenLayout";

const BLUR_INTENSITY = 80;

export type AnimatedHeaderTopBackdrop = {
  readonly animatedColor?: SharedValue<string>;
  readonly fallbackColor?: string;
  readonly height: number;
};

export type AnimatedHeaderScrollProps = Pick<
  ScrollViewProps,
  "contentContainerStyle" | "onScroll" | "style"
>;

export function AnimatedHeader({
  children,
  header,
  layout,
  disableScrollBlur = false,
  blurTint,
  topBackdrop,
  refreshControl,
  scrollY: scrollYProp,
}: {
  children: ReactNode | ((props: AnimatedHeaderScrollProps) => ReactNode);
  header?: ReactNode;
  layout: ReturnType<typeof useTabScreenLayout>;
  disableScrollBlur?: boolean;
  blurTint?: BlurViewProps["tint"];
  topBackdrop?: AnimatedHeaderTopBackdrop;
  refreshControl?: ScrollViewProps["refreshControl"];
  scrollY?: SharedValue<number>;
}) {
  const { isDark } = useAppTheme();
  const blurTargetRef = useRef<HostInstance | null>(null);
  const localScrollY = useSharedValue(0);
  const scrollY = scrollYProp ?? localScrollY;
  const { topInset, style, contentContainerStyle, onHeaderLayout } = layout;
  const shouldRenderTopBackdrop = topBackdrop !== undefined;
  const [hasScrolled, setHasScrolled] = useState(false);
  const shouldRenderScrollBlur = !disableScrollBlur && hasScrolled;

  // Mount the scroll blur only while the content is scrolled. At rest the
  // header is fully transparent, yet a mounted BlurView still redraws its
  // full-screen blur layer on every frame (RenderEffect on Android,
  // UIVisualEffectView on iOS), so every tab paid for a blur nobody saw.
  useAnimatedReaction(
    () => scrollY.get() > 0,
    (scrolled, previous) => {
      if (scrolled !== previous) {
        scheduleOnRN(setHasScrolled, scrolled);
      }
    },
  );

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.set(e.contentOffset.y);
    },
  });

  // GPU-composited opacity — no BlurView re-renders per frame
  const blurOpacityStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 200], [0, 1], "clamp"),
  }));

  const topBackdropStyle = useAnimatedStyle(() => ({
    backgroundColor:
      topBackdrop?.animatedColor?.value ??
      topBackdrop?.fallbackColor ??
      "transparent",
    height: topInset + (topBackdrop?.height ?? 0) + Math.max(-scrollY.value, 0),
    opacity: interpolate(
      scrollY.value,
      [-24, 0, 22],
      [1, 1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View className="h-full">
      {shouldRenderTopBackdrop ? (
        <Animated.View
          pointerEvents="none"
          style={topBackdropStyle}
          className="absolute top-0 right-0 left-0"
        />
      ) : null}
      <BlurTargetView ref={blurTargetRef} className="h-full">
        <ScrollOffsetContext value={scrollY}>
          {Predicate.isFunction(children) ? (
            children({
              onScroll: scrollHandler,
              style,
              contentContainerStyle,
            })
          ) : (
            <BodyScrollView
              onScroll={scrollHandler}
              refreshControl={refreshControl}
              style={style}
              contentContainerClassName="gap-xs"
              showsVerticalScrollIndicator
              alwaysBounceVertical={false}
              contentContainerStyle={contentContainerStyle}
            >
              {children}
            </BodyScrollView>
          )}
        </ScrollOffsetContext>
      </BlurTargetView>
      <View
        pointerEvents="box-none"
        onLayout={onHeaderLayout}
        className="absolute top-0 right-0 left-0 z-1"
      >
        {shouldRenderScrollBlur ? (
          <Animated.View
            pointerEvents="none"
            style={blurOpacityStyle}
            className="absolute top-0 right-0 -bottom-9 left-0"
          >
            <BlurView
              blurMethod={
                Platform.OS === "android"
                  ? "dimezisBlurViewSdk31Plus"
                  : undefined
              }
              blurTarget={blurTargetRef}
              intensity={BLUR_INTENSITY}
              tint={
                blurTint ??
                (isDark ? "systemThinMaterialDark" : "systemThinMaterialLight")
              }
              className="absolute top-0 right-0 bottom-9 left-0"
            />
          </Animated.View>
        ) : null}
        {header ?? (
          <Header
            className={cn(
              "bg-transparent items-center pb-4xs",
              Platform.OS === "ios" ? "-mt-3xs" : "-mt-4xs",
            )}
          >
            <LiveStream />
          </Header>
        )}
      </View>
    </View>
  );
}
