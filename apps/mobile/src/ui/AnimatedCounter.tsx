import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";

import { counterCharacters, nextWheelPosition } from "./AnimatedCounter.logic";
import { Text, type TextProps } from "./Text";

type CounterTextProps = Pick<TextProps, "variant" | "color">;
type AnimatedCounterProps = CounterTextProps & {
  value: number;
  formatValue?: (value: number) => string;
  animateOnMount?: boolean;
};

// Duplicate the boundary digits so wrapping in either direction stays seamless.
const DIGIT_STRIP = Array.from({ length: 12 }, (_, index) => ({
  key: index,
  digit: (index + 9) % 10,
}));
const ROLL_DURATION = 850;

function DigitWheel({
  digit,
  value,
  height,
  animateOnMount,
  ...textProps
}: CounterTextProps & {
  digit: number;
  value: number;
  height: number;
  animateOnMount: boolean;
}) {
  const position = useSharedValue(animateOnMount ? 0 : digit);
  const previousValue = useRef(animateOnMount ? 0 : value);

  useEffect(() => {
    if (!height) {
      return;
    }
    const direction = Math.sign(value - previousValue.current);
    previousValue.current = value;
    // Read and update the wheel entirely on the UI thread, including interrupted rolls.
    scheduleOnUI(() => {
      const current = position.get();
      const target = nextWheelPosition(current, digit, direction);
      if (current === target) {
        return;
      }
      position.set(
        withTiming(target, {
          duration: ROLL_DURATION,
          easing: Easing.out(Easing.cubic),
        }),
      );
    });
  }, [animateOnMount, digit, height, position, value]);

  const animatedStyle = useAnimatedStyle(() => {
    const face = ((position.get() % 10) + 10) % 10;
    return { transform: [{ translateY: -(face + 1) * height }] };
  });

  return (
    <View className="overflow-hidden">
      <Text
        {...textProps}
        className={height > 0 ? "tabular-nums opacity-0" : "tabular-nums"}
      >
        {animateOnMount ? 0 : digit}
      </Text>
      {height > 0 ? (
        <Animated.View
          style={animatedStyle}
          className="absolute top-0 right-0 left-0"
        >
          {/* Explicit rows keep native multiline rounding from shifting later digits. */}
          {DIGIT_STRIP.map(({ key, digit: face }) => (
            <Text
              key={key}
              {...textProps}
              className="shrink-0 text-center tabular-nums"
              style={{ height }}
              numberOfLines={1}
            >
              {face}
            </Text>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Native digit wheels inspired by https://www.rareui.com/components/animatedcounter. */
export function AnimatedCounter({
  value,
  formatValue = String,
  animateOnMount = true,
  ...textProps
}: AnimatedCounterProps) {
  const reduceMotion = useReducedMotion();
  const [height, setHeight] = useState(0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const formatted = formatValue(safeValue);

  const measureHeight = (event: LayoutChangeEvent) => {
    setHeight(event.nativeEvent.layout.height);
  };

  if (reduceMotion) {
    return (
      <Text {...textProps} className="tabular-nums">
        {formatted}
      </Text>
    );
  }

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={formatted}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
        pointerEvents="none"
        onLayout={measureHeight}
        className="flex-row items-center self-start"
      >
        {counterCharacters(formatted).map(({ character, isDigit, key }) =>
          isDigit ? (
            <DigitWheel
              key={key}
              digit={Number(character)}
              value={safeValue}
              height={height}
              animateOnMount={animateOnMount}
              {...textProps}
            />
          ) : (
            <View key={key}>
              <Text {...textProps} className="tabular-nums">
                {character}
              </Text>
            </View>
          ),
        )}
      </View>
    </View>
  );
}
