import { Predicate } from "effect";
import { useIsFocused } from "expo-router";
import { useEffect } from "react";
import {
  AccessibilityInfo,
  AppState,
  processColor,
  useWindowDimensions,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  StyledImage as Image,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { useViewportVisibility } from "@/hooks/useViewportVisibility";
import type { FeaturedEventData } from "@/relay/featuredEvents";
import { useAppTheme } from "@/theme/useAppTheme";

// Integer harmonics let the fields roll and stretch at different points
// without a hitch at the loop seam.
const FLOW_SPEED = 0.4;
const DRIFT_DURATION = (Math.PI * 2 * 1000) / (FLOW_SPEED * 1.2);
const MAX_FLOW_SCALE = 1.28;
const GLOW_TOP_PADDING = 220;
const GLOW_BOTTOM_PADDING = 100;
// One small, shared alpha texture replaces a full-size SVG bitmap per color
// per slide. Its radial stops are 0/1, 0.3/0.9, 0.65/0.4 and 1/0.
const GLOW_MASK = require("../../../assets/images/gradient-bloom.png");

function useGradientDrift(travelX: number, travelY: number, visible: boolean) {
  const isFocused = useIsFocused();
  const phase = useSharedValue(0);

  useEffect(() => {
    let disposed = false;
    let motionReduced = true;
    let running = false;
    let receivedMotionEvent = false;

    const syncAnimation = () => {
      const shouldRun =
        visible &&
        isFocused &&
        AppState.currentState === "active" &&
        !motionReduced;
      if (disposed || shouldRun === running) {
        return;
      }
      running = shouldRun;
      cancelAnimation(phase);
      if (shouldRun) {
        // Resume from the frozen position. Each full turn meets its starting
        // transform exactly, so repeating never jumps or reverses abruptly.
        phase.set(
          withRepeat(
            withTiming(phase.get() + 1, {
              duration: DRIFT_DURATION,
              easing: Easing.linear,
              // The live accessibility listener below owns this gate instead
              // of Reanimated's startup snapshot of the system preference.
              reduceMotion: ReduceMotion.Never,
            }),
            -1,
            false,
            undefined,
            ReduceMotion.Never,
          ),
        );
      }
    };

    const appStateSubscription = AppState.addEventListener(
      "change",
      syncAnimation,
    );
    const motionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        receivedMotionEvent = true;
        motionReduced = enabled;
        syncAnimation();
      },
    );
    // Wait for the current preference before starting, and listen for changes
    // while Home stays mounted (including changes made in the background).
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!receivedMotionEvent) {
          motionReduced = enabled;
          syncAnimation();
        }
      })
      .catch(() => undefined);
    syncAnimation();

    return () => {
      disposed = true;
      appStateSubscription.remove();
      motionSubscription.remove();
      cancelAnimation(phase);
    };
  }, [isFocused, phase, visible]);

  const driftStyle = useAnimatedStyle(() => {
    const angle = phase.get() * Math.PI * 2;
    const sweep = Math.sin(angle);
    const roll = Math.sin(angle * 2);
    const stretch = Math.cos(angle);
    return {
      transform: [
        { translateX: (sweep * 0.78 + roll * 0.22) * travelX },
        { translateY: (stretch * 0.8 - roll * 0.2) * travelY },
        { rotate: `${-16 + sweep * 26 + roll * 6}deg` },
        { scaleX: 1.1 + stretch * 0.18 },
        { scaleY: 0.88 - stretch * 0.1 },
      ],
    };
  });

  // Counterflow and opposing stretch create broad, folding waves using the
  // same three textures. Only native transforms change on each frame.
  const flowStyle = useAnimatedStyle(() => {
    const angle = phase.get() * Math.PI * 2 + (Math.PI * 2) / 3;
    const sweep = Math.sin(angle);
    const roll = Math.sin(angle * 2);
    const stretch = Math.cos(angle);
    return {
      transform: [
        { translateX: (-sweep * 0.8 + roll * 0.2) * travelX },
        { translateY: (stretch * 0.75 + roll * 0.25) * travelY },
        { rotate: `${18 - sweep * 24 + roll * 5}deg` },
        { scaleX: 1.1 - stretch * 0.16 },
        { scaleY: 0.9 + stretch * 0.12 },
      ],
    };
  });

  const bloomStyle = useAnimatedStyle(() => {
    const angle = phase.get() * Math.PI * 2 + (Math.PI * 4) / 3;
    const sweep = Math.sin(angle);
    const roll = Math.sin(angle * 2);
    const stretch = Math.cos(angle);
    return {
      transform: [
        { translateX: (sweep * 0.6 + roll * 0.15) * travelX },
        { translateY: (-stretch * 0.8 + roll * 0.2) * travelY },
        { rotate: `${-8 + sweep * 20 - roll * 6}deg` },
        { scaleX: 1 + stretch * 0.14 },
        { scaleY: 0.94 - stretch * 0.14 },
      ],
    };
  });

  return { driftStyle, flowStyle, bloomStyle };
}

function eventTint(
  event: FeaturedEventData,
  preferred: "light" | "dark" | "accent",
) {
  const palette = event.prominentColors;
  const candidates = [
    palette?.[preferred],
    palette?.accent,
    palette?.light,
    palette?.dark,
  ];
  return candidates.find(
    (color) => color?.trim() && Predicate.isNumber(processColor(color)),
  );
}

function gradientTint(color: string | undefined) {
  const processed = processColor(color);
  if (!Predicate.isNumber(processed)) {
    return { color: "#000000", opacity: 0 };
  }
  const red = (processed >>> 16) & 255;
  const green = (processed >>> 8) & 255;
  const blue = processed & 255;
  return {
    color: `rgb(${red}, ${green}, ${blue})`,
    opacity: (processed >>> 24) / 255,
  };
}

function SlideGlow({
  color,
  strength,
  index,
  count,
  progress,
}: {
  color: string | undefined;
  strength: number;
  index: number;
  count: number;
  progress: SharedValue<number>;
}) {
  const tint = gradientTint(color);
  const opacity = tint.opacity * strength;
  const slideStyle = useAnimatedStyle(() => {
    if (count === 1) {
      return { opacity: 1 };
    }
    const wrapped = ((progress.get() % count) + count) % count;
    const distance = Math.abs(wrapped - index);
    return { opacity: Math.max(0, 1 - Math.min(distance, count - distance)) };
  });

  // Static, soft-edged color fields crossfade on the UI thread. Only
  // the two neighboring slides are visible, including across the loop seam.
  return (
    <Animated.View style={slideStyle} className="absolute inset-0">
      <Image
        source={GLOW_MASK}
        contentFit="fill"
        tintColor={tint.color}
        cachePolicy="memory"
        transition={0}
        accessible={false}
        style={{ opacity }}
        className="absolute inset-0"
      />
    </Animated.View>
  );
}

export function HomeBackground({
  events,
  carouselProgress,
  glowBounds,
  scrollY,
}: {
  events: readonly FeaturedEventData[];
  carouselProgress: SharedValue<number>;
  glowBounds: { top: number; height: number } | null;
  scrollY: SharedValue<number>;
}) {
  const { isDark, colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const backgroundColor = colors.background;
  const bottomColor = backgroundGradient.at(-1) ?? backgroundColor;
  const { width } = useWindowDimensions();
  const glowHeight =
    (glowBounds?.height ?? 0) + GLOW_TOP_PADDING + GLOW_BOTTOM_PADDING;
  const travelX = Math.min(width * 0.32, 160);
  const travelY = Math.min(glowHeight * 0.16, 110);
  // Enclose every rotation/scale in a circle around each field's center.
  // Keep soft edges mounted until even the largest orbit leaves the screen.
  const radius =
    Math.hypot(width * 1.65, glowHeight * 0.94) * 0.5 * MAX_FLOW_SCALE +
    travelY;
  const glowTop = (glowBounds?.top ?? 0) - GLOW_TOP_PADDING;
  const isVisible = useViewportVisibility(
    scrollY,
    glowBounds && events.length > 0
      ? {
          top: glowTop + glowHeight * 0.39 - radius,
          bottom: glowTop + glowHeight * 0.7 + radius,
        }
      : null,
  );
  const { driftStyle, flowStyle, bloomStyle } = useGradientDrift(
    travelX,
    travelY,
    isVisible,
  );
  const fields = [
    {
      tint: isDark ? "dark" : "light",
      strength: isDark ? 0.48 : 0.5,
      bounds: { top: -glowHeight * 0.08, left: -width * 0.55 },
      motion: driftStyle,
    },
    {
      tint: "accent",
      strength: isDark ? 0.38 : 0.42,
      bounds: { top: glowHeight * 0.08, right: -width * 0.6 },
      motion: flowStyle,
    },
    {
      tint: isDark ? "light" : "dark",
      strength: isDark ? 0.18 : 0.22,
      bounds: { top: glowHeight * 0.23, left: -width * 0.15 },
      motion: bloomStyle,
    },
  ] as const;
  const carouselStyle = useAnimatedStyle(() => ({
    opacity: glowBounds === null ? 0 : 1,
    transform: [
      {
        translateY: (glowBounds?.top ?? 0) - scrollY.get() - GLOW_TOP_PADDING,
      },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      testID="design-v2-home-background"
      style={{ backgroundColor }}
      className="absolute inset-0 overflow-hidden"
    >
      <LinearGradient
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      {/* Follow the measured carousel and shortcut cards while scrolling.
          The wider upper glow and the fade below the shortcuts reveal the
          default gradient at their edges. Missing palettes stay transparent. */}
      {isVisible && (
        <Animated.View
          testID="design-v2-home-carousel-glow"
          style={[{ height: glowHeight }, carouselStyle]}
          className="absolute top-0 right-0 left-0"
        >
          {fields.map((field) => (
            <Animated.View
              key={field.tint}
              testID={`design-v2-home-gradient-${field.tint}`}
              style={[
                {
                  position: "absolute",
                  width: width * 1.65,
                  height: glowHeight * 0.94,
                },
                field.bounds,
                field.motion,
              ]}
            >
              {events.map((event, index) => (
                <SlideGlow
                  key={`${event.eventImageUrl}:${index}`}
                  color={eventTint(event, field.tint)}
                  strength={field.strength}
                  index={index}
                  count={events.length}
                  progress={carouselProgress}
                />
              ))}
            </Animated.View>
          ))}
        </Animated.View>
      )}
      <LinearGradient
        colors={[backgroundColor, backgroundColor, `${backgroundColor}00`]}
        locations={[0, 0.1, 0.34]}
        className="absolute inset-0"
      />
      <LinearGradient
        colors={[`${bottomColor}00`, bottomColor, bottomColor]}
        locations={[0, 0.7, 1]}
        style={{ height: 120 }}
        className="absolute right-0 bottom-0 left-0"
      />
    </Animated.View>
  );
}
