import { useEffect, useState } from "react";
import { Animated as NativeAnimated, Easing, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { cn } from "@/utils/styling";

/** onImage draws white dots over artwork; onSurface follows the theme text. */
type PaginationTone = "onImage" | "onSurface";

const STRAIGHT_DOT_SIZE = 6;
const STRAIGHT_ACTIVE_WIDTH = 16;

const STRAIGHT_PROGRESS_MIN_WIDTH = 3;

const StraightDotProgressFill = function StraightDotProgressFill({
  progress,
  tone,
}: {
  progress: NativeAnimated.Value;
  tone: PaginationTone;
}) {
  return (
    <NativeAnimated.View
      style={{
        transform: [
          {
            scaleX: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [
                STRAIGHT_PROGRESS_MIN_WIDTH / STRAIGHT_ACTIVE_WIDTH,
                1,
              ],
              extrapolate: "clamp",
            }),
          },
        ],
      }}
      className={cn(
        "absolute top-0 left-0 z-1 h-[5px] w-3xs origin-left rounded-[2.5px]",
        tone === "onImage" ? "bg-[#FFFFFF]" : "bg-design-text",
      )}
    />
  );
};

const StraightPaginationDot = function StraightPaginationDot({
  isActive,
  autoplayProgress,
  tone,
}: {
  isActive: boolean;
  autoplayProgress: NativeAnimated.Value;
  tone: PaginationTone;
}) {
  const dotStyle = useAnimatedStyle(
    () => ({
      width: withSpring(isActive ? STRAIGHT_ACTIVE_WIDTH : STRAIGHT_DOT_SIZE, {
        damping: 18,
        stiffness: 220,
        mass: 0.7,
        overshootClamping: true,
      }),
    }),
    [isActive],
  );

  return (
    <Animated.View
      style={dotStyle}
      className={cn(
        "relative h-[5px] overflow-hidden rounded-[2.5px]",
        tone === "onImage"
          ? "bg-[rgba(255,255,255,0.24)]"
          : "bg-design-selected",
      )}
    >
      {isActive ? (
        <StraightDotProgressFill progress={autoplayProgress} tone={tone} />
      ) : null}
    </Animated.View>
  );
};

export function StraightPagination({
  activeIndex,
  count,
  autoplay,
  interval = 5000,
  tone = "onImage",
}: {
  activeIndex: number;
  count: number;
  autoplay: boolean;
  interval?: number;
  tone?: PaginationTone;
}) {
  const [autoplayProgress] = useState(() => new NativeAnimated.Value(0));
  const animatePagination = autoplay && count > 1;

  useEffect(() => {
    autoplayProgress.setValue(0);
    if (!animatePagination) {
      return;
    }
    const animation = NativeAnimated.timing(autoplayProgress, {
      toValue: 1,
      duration: interval,
      easing: (value) => Easing.linear(value),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [activeIndex, animatePagination, autoplayProgress, interval]);
  return (
    <View className="gap-6xs flex-row items-center">
      {Array.from({ length: count }).map((_, index) => (
        <StraightPaginationDot
          key={index}
          isActive={index === activeIndex}
          autoplayProgress={autoplayProgress}
          tone={tone}
        />
      ))}
    </View>
  );
}
