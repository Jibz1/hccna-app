import { useIsFocused } from "expo-router";
import { useEffect } from "react";
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useIsAppActive } from "@/hooks/useIsAppActive";

type LiveStreamIndicatorProps = {
  isLive: boolean;
  hideIcon?: boolean;
  inactiveColor?: string;
  size?: number;
};

export function LiveStreamIndicator({
  isLive,
  hideIcon = false,
  inactiveColor = "rgba(255, 255, 255, 1)",
  size = 14,
}: LiveStreamIndicatorProps) {
  const animation = useSharedValue(0);
  const isFocused = useIsFocused();
  const appIsActive = useIsAppActive();
  // Inactive tabs stay mounted, so pulse only where the dot can be seen.
  const shouldPulse = isLive && isFocused && appIsActive;

  useEffect(() => {
    if (shouldPulse) {
      animation.set(
        withRepeat(
          withTiming(1, { duration: 800 }),
          -1, // -1 means infinite loop
          true, // boomerang effect (reverses the animation)
        ),
      );
    } else {
      // Cancel the repeating animation and smoothly transition back to 0
      cancelAnimation(animation);
      animation.set(withTiming(0, { duration: 200 }));
    }
    return () => {
      cancelAnimation(animation);
    };
  }, [animation, shouldPulse]);

  // Use animated View instead of Skia Canvas to reduce GPU overhead on Android
  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: isLive
      ? interpolateColor(
          animation.get(),
          [0, 1],
          ["red", "rgba(242, 242, 242, 0.7)"],
        )
      : inactiveColor,
  }));

  if (hideIcon && !isLive) {
    return null;
  }

  return (
    <Animated.View
      style={[
        animatedStyle,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  );
}
