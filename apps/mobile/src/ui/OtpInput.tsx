import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { TextInput, View, type TextInputInstance } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Rect } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";
import { Text } from "@/ui/Text";
import { errorHaptic, successHaptic } from "@/utils/haptics";
import { cn } from "@/utils/styling";

import {
  caretIndexFor,
  resolveOtpInput,
  type OtpStatus,
} from "./OtpInput.logic";

export type { OtpStatus };

export type OtpInputHandle = {
  focus: () => void;
  blur: () => void;
};

export type OtpInputProps = {
  value: string;
  onChange: (code: string) => void;
  /** Fires once the last slot is filled. */
  onComplete?: (code: string) => void;
  length?: number;
  status?: OtpStatus;
  autoFocus?: boolean;
  disabled?: boolean;
  ref?: Ref<OtpInputHandle>;
  appearance?: "default" | "design";
};

const CELL_SIZE = 48;
const CELL_RADIUS = 12;
const CELL_GAP = 8;
const CARET_WIDTH = 2;
const CARET_HEIGHT = 24;

const POSITIVE = "#47e299";

// Reference motion (rareui OTP input): characters roll in on a stiff spring,
// the caret follows on a slightly more damped one.
const ROLL_SPRING = { stiffness: 500, damping: 34 };
const CARET_SPRING = { stiffness: 500, damping: 40 };
const ROLL_DISTANCE = CELL_SIZE * 1.1;
const BLINK_HALF_MS = 550;
const SHAKE_FRAMES = [-5, 4, -2, 0];
const SHAKE_STEP_MS = 80;

const RING_INSET = 1;
const RING_STROKE = 2;
const RING_SIZE = CELL_SIZE - RING_INSET * 2;
const RING_RADIUS = CELL_RADIUS - RING_INSET;
const RING_LENGTH =
  4 * (RING_SIZE - 2 * RING_RADIUS) + 2 * Math.PI * RING_RADIUS;
const RING_DELAY_MS = 150;
const RING_STAGGER_MS = 50;
const RING_DURATION_MS = 450;

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const AnimatedText = Animated.createAnimatedComponent(Text);

function caretOffsetFor(index: number, cellSize: number) {
  return index * (cellSize + CELL_GAP) + cellSize / 2 - CARET_WIDTH / 2;
}

type SlotProps = {
  index: number;
  char: string;
  cleared: boolean;
  status: OtpStatus;
  disabled: boolean;
  reduceMotion: boolean;
  cellSize: number;
  appearance: NonNullable<OtpInputProps["appearance"]>;
};

function Slot({
  index,
  char,
  cleared,
  status,
  disabled,
  reduceMotion,
  cellSize,
  appearance,
}: SlotProps) {
  const [displayed, setDisplayed] = useState(char);
  const previousChar = useRef(char);
  const y = useSharedValue(0);

  // Keep a cleared digit mounted while it animates out, but render replacements
  // immediately without a second render from the animation effect.
  if (char && displayed !== char) {
    setDisplayed(char);
  }

  useEffect(() => {
    const previous = previousChar.current;
    previousChar.current = char;
    if (char === previous) {
      return;
    }
    if (char) {
      if (reduceMotion) {
        y.set(0);
        return;
      }
      y.set(ROLL_DISTANCE);
      y.set(withSpring(0, ROLL_SPRING));
      return;
    }
    // Cleared characters drop out the bottom; replaced ones leave out the top.
    const exitY = cleared ? ROLL_DISTANCE : -ROLL_DISTANCE;
    y.set(reduceMotion ? exitY : withSpring(exitY, ROLL_SPRING));
  }, [char, cleared, reduceMotion, y]);

  const charStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.get() }],
  }));

  return (
    <View
      testID="otp-slot"
      className={cn(
        "rounded-m items-center justify-center overflow-hidden border",
        appearance === "design"
          ? "bg-design-surface-strong border-design-input-border"
          : "bg-background-accent border-content-persistentWhite/28",
        status === "error" && "border-2 border-content-negative",
        disabled && "opacity-50",
      )}
      style={{ width: cellSize, height: cellSize }}
    >
      <AnimatedText
        variant="labelLg/medium"
        color={appearance === "design" ? "designPrimary" : "persistentWhite"}
        centered
        style={charStyle}
      >
        {displayed}
      </AnimatedText>
      {status === "success" ? (
        <SuccessRing
          index={index}
          reduceMotion={reduceMotion}
          cellSize={cellSize}
        />
      ) : null}
    </View>
  );
}

function SuccessRing({
  index,
  reduceMotion,
  cellSize,
}: {
  index: number;
  reduceMotion: boolean;
  cellSize: number;
}) {
  const dashOffset = useSharedValue(reduceMotion ? 0 : RING_LENGTH);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    dashOffset.set(
      withDelay(
        RING_DELAY_MS + index * RING_STAGGER_MS,
        withTiming(0, {
          duration: RING_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        }),
      ),
    );
  }, [dashOffset, index, reduceMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.get(),
  }));

  return (
    <Svg
      pointerEvents="none"
      className="absolute inset-0"
      width={cellSize}
      height={cellSize}
      viewBox={`0 0 ${CELL_SIZE} ${CELL_SIZE}`}
    >
      <AnimatedRect
        x={RING_INSET}
        y={RING_INSET}
        width={RING_SIZE}
        height={RING_SIZE}
        rx={RING_RADIUS}
        fill="none"
        stroke={POSITIVE}
        strokeWidth={RING_STROKE}
        strokeDasharray={[RING_LENGTH, RING_LENGTH]}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}

function Caret({
  index,
  reduceMotion,
  cellSize,
  appearance,
}: {
  index: number;
  reduceMotion: boolean;
  cellSize: number;
  appearance: NonNullable<OtpInputProps["appearance"]>;
}) {
  const target = caretOffsetFor(index, cellSize);
  const opacity = useSharedValue(1);

  const positionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: reduceMotion ? target : withSpring(target, CARET_SPRING) },
    ],
  }));

  useEffect(() => {
    opacity.set(
      withRepeat(
        withSequence(
          withDelay(BLINK_HALF_MS, withTiming(0, { duration: 0 })),
          withDelay(BLINK_HALF_MS, withTiming(1, { duration: 0 })),
        ),
        -1,
      ),
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [opacity]);

  const blinkStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      className={cn(
        "absolute left-0 h-xs w-[2px] rounded-[1px]",
        appearance === "design"
          ? "bg-design-text"
          : "bg-content-persistentWhite",
      )}
      style={[
        { top: (cellSize - CARET_HEIGHT) / 2 },
        positionStyle,
        blinkStyle,
      ]}
    />
  );
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  status = "idle",
  autoFocus = false,
  disabled = false,
  ref,
  appearance = "default",
}: OtpInputProps) {
  const inputRef = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const [cellSize, setCellSize] = useState(CELL_SIZE);
  const [cleared, setCleared] = useState(false);
  const reduceMotion = useReducedMotion();
  const rowX = useSharedValue(0);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
    }),
    [],
  );

  useEffect(() => {
    if (status === "error") {
      void errorHaptic();
      if (!reduceMotion) {
        rowX.set(
          withSequence(
            ...SHAKE_FRAMES.map((frame) =>
              withTiming(frame, {
                duration: SHAKE_STEP_MS,
                easing: Easing.out(Easing.quad),
              }),
            ),
          ),
        );
      }
    }
    if (status === "success") {
      void successHaptic();
    }
  }, [reduceMotion, rowX, status]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: rowX.get() }],
  }));

  const handleChangeText = (text: string) => {
    const next = resolveOtpInput(value, text, length);
    if (next.code === value) {
      return;
    }
    setCleared(next.cleared);
    onChange(next.code);
    if (next.complete) {
      onComplete?.(next.code);
    }
  };

  const caretIndex = caretIndexFor(value, length);
  const slots = Array.from({ length }, (_, index) => value[index] ?? "");

  return (
    <View
      className="w-full self-center"
      style={{ maxWidth: length * CELL_SIZE + (length - 1) * CELL_GAP }}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (width > 0) {
          setCellSize(
            Math.min(CELL_SIZE, (width - (length - 1) * CELL_GAP) / length),
          );
        }
      }}
    >
      <Animated.View className="gap-5xs flex-row items-center" style={rowStyle}>
        {slots.map((char, index) => (
          <Slot
            key={index}
            index={index}
            char={char}
            cleared={cleared}
            status={status}
            disabled={disabled}
            reduceMotion={reduceMotion}
            cellSize={cellSize}
            appearance={appearance}
          />
        ))}
        {focused && caretIndex !== null ? (
          <Caret
            index={caretIndex}
            reduceMotion={reduceMotion}
            cellSize={cellSize}
            appearance={appearance}
          />
        ) : null}
      </Animated.View>
      <TextInput
        ref={inputRef}
        accessibilityLabel={`${length} digit verification code`}
        value={value}
        onChangeText={handleChangeText}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        editable={!disabled}
        caretHidden
        autoCorrect={false}
        spellCheck={false}
        // Keep the input hit-testable so taps and long-press paste reach it.
        // Tiny, left-aligned transparent text places the caret after the code.
        className="absolute inset-0 text-left text-[1px] text-transparent"
      />
    </View>
  );
}

OtpInput.displayName = "OtpInput";
