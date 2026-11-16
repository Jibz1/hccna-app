import { usePreventRemove } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

export function useMoreMenuMotion(buttonSize: number) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const menuWidth = useSharedValue(0);
  const menuHeight = useSharedValue(0);
  const isClosing = useRef(false);
  const [hasClosed, setHasClosed] = useState(false);

  const onMenuLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (layout.width <= 0 || layout.height <= 0) {
      return;
    }
    menuWidth.set(layout.width);
    menuHeight.set(layout.height);
    if (isClosing.current) {
      return;
    }
    progress.set(
      withSpring(1, {
        stiffness: 420,
        damping: 30,
        mass: 1,
        reduceMotion: ReduceMotion.System,
      }),
    );
  };

  useEffect(
    () => () => {
      cancelAnimation(progress);
    },
    [progress],
  );

  // Finish the exit before removing the route, including system Back and menu links.
  usePreventRemove(!reduceMotion && !hasClosed, ({ repeat }) => {
    if (isClosing.current) {
      return;
    }
    isClosing.current = true;
    const complete = () => {
      // `repeat` lifts the prevention and replays the blocked action.
      // Dispatching the action directly would be prevented again.
      setHasClosed(true);
      repeat();
    };
    progress.set(
      withTiming(
        0,
        {
          duration: 220,
          easing: Easing.inOut(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished) {
            scheduleOnRN(complete);
          }
        },
      ),
    );
  });

  const scale = useDerivedValue(() => ({
    // Keep the surface collapsed until its first layout to avoid a full-size flash.
    x: menuWidth.get()
      ? interpolate(progress.get(), [0, 1], [buttonSize / menuWidth.get(), 1])
      : 0.001,
    y: menuHeight.get()
      ? interpolate(progress.get(), [0, 1], [buttonSize / menuHeight.get(), 1])
      : 0.001,
  }));
  const surfaceStyle = useAnimatedStyle(() => ({
    // Only the material stretches from the button; labels keep their proportions.
    // Never fade an ancestor of GlassView: native Liquid Glass loses its material.
    borderRadius: interpolate(
      progress.get(),
      [0, 1],
      [Math.max(menuWidth.get(), menuHeight.get()) / 2, 28],
      Extrapolation.CLAMP,
    ),
    transform: [{ scaleX: scale.get().x }, { scaleY: scale.get().y }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.get(),
      [0.35, 0.85],
      [0, 1],
      Extrapolation.CLAMP,
    ),
    transform: [{ translateY: 12 * (1 - progress.get()) }],
  }));
  const contentContainerStyle = useAnimatedStyle(() => ({
    // Counter the shell's stretch while its clip reveals the menu contents.
    transform: [{ scaleX: 1 / scale.get().x }, { scaleY: 1 / scale.get().y }],
  }));
  const ellipsisStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.get(),
      [0, 0.35],
      [1, 0],
      Extrapolation.CLAMP,
    ),
    transform: [{ scale: 1 - 0.2 * progress.get() }],
  }));
  const closeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.get(),
      [0.45, 1],
      [0, 1],
      Extrapolation.CLAMP,
    ),
    transform: [{ rotate: `${-90 * (1 - progress.get())}deg` }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
  }));

  return {
    onMenuLayout,
    surfaceStyle,
    contentContainerStyle,
    contentStyle,
    ellipsisStyle,
    closeStyle,
    backdropStyle,
  };
}
