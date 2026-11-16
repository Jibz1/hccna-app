import { useIsFocused } from "expo-router";
import { useState } from "react";
import Animated, { useReducedMotion } from "react-native-reanimated";

import { useCounterEntrance } from "@/hooks/useCounterEntrance";
import { AnimatedCounter } from "@/ui/AnimatedCounter";
import { Text, type TextProps } from "@/ui/Text";
import { formatCurrency } from "@/utils/formatAmount";

type GivingAmountProps = Pick<TextProps, "variant" | "color"> & {
  value: number;
};

function UnseenGivingAmount({
  value,
  onEnter,
  ...textProps
}: GivingAmountProps & { onEnter: () => void }) {
  const { ref, onLayout } = useCounterEntrance(onEnter);

  return (
    <Animated.View ref={ref} onLayout={onLayout} collapsable={false}>
      <Text {...textProps} className="tabular-nums">
        {formatCurrency(value)}
      </Text>
    </Animated.View>
  );
}

export function AnimatedGivingAmount({
  value,
  ...textProps
}: GivingAmountProps) {
  const isFocused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const [hasEntered, setHasEntered] = useState(false);

  // Retain the counter across tab changes and retire its observer after first sight.
  if (hasEntered && !reduceMotion) {
    return (
      <AnimatedCounter
        value={value}
        formatValue={formatCurrency}
        {...textProps}
      />
    );
  }

  if (!isFocused || reduceMotion) {
    return (
      <Text {...textProps} className="tabular-nums">
        {formatCurrency(value)}
      </Text>
    );
  }

  return (
    <UnseenGivingAmount
      value={value}
      onEnter={() => {
        setHasEntered(true);
      }}
      {...textProps}
    />
  );
}
