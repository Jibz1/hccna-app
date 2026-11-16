import { View } from "react-native";

import { TimeUnit, useTimeAgo } from "@/hooks/utils/useTimeAgo";
import { Text, TextProps } from "@/ui/Text";

export interface CountDownTimerProps extends Pick<
  TextProps,
  "variant" | "color" | "className"
> {
  timestamp: number | undefined;
  label?: string;
  endLabel?: string;
}

export function CountDownTimer({
  timestamp,
  label,
  endLabel = "now",
  ...textProps
}: CountDownTimerProps) {
  const timeAgo = useTimeAgo({
    timeFrom: timestamp ?? null,
    shouldEnd: true,
    endLabel,
    maxTimeUnit: TimeUnit.ONE_HOUR,
    options: {
      shortenHoursLabel: false,
      shortenMinutesLabel: false,
      shortenSecondsLabel: false,
    },
  });

  return (
    <View>
      <Text {...textProps}>
        {timeAgo === endLabel ? "" : label} {timeAgo}
      </Text>
    </View>
  );
}
