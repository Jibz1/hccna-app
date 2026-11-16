import { View } from "react-native";

import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export function CastrDestinationStatus({
  destinations,
}: {
  destinations?: readonly { broadcasting_status?: string | null }[] | null;
}) {
  const platforms = destinations ?? [];
  const liveCount = platforms.filter(
    (destination) => destination.broadcasting_status === "online",
  ).length;
  const hasUnknownStatus = platforms.some(
    (destination) =>
      destination.broadcasting_status !== "online" &&
      destination.broadcasting_status !== "offline",
  );
  const allLive = liveCount > 0 && liveCount === platforms.length;
  const partialOrUnknown = liveCount > 0 || hasUnknownStatus;
  const label =
    liveCount > 0
      ? `${liveCount} of ${platforms.length} live`
      : hasUnknownStatus
        ? "Status unknown"
        : platforms.length > 0
          ? `0 of ${platforms.length} live`
          : "No destinations";

  return (
    <View className="px-3xs py-5xs gap-5xs bg-design-surface-strong border-design-border max-w-full flex-row items-center self-start rounded-full border">
      <View
        accessible={false}
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          allLive
            ? "bg-content-positive"
            : partialOrUnknown
              ? "bg-design-accent"
              : "bg-design-text-muted",
        )}
      />
      <Text
        testID="castr-destination-summary"
        accessibilityLabel={
          liveCount > 0 || (platforms.length > 0 && !hasUnknownStatus)
            ? `${liveCount} of ${platforms.length} destinations live`
            : label
        }
        color={
          allLive
            ? "positive"
            : partialOrUnknown
              ? "designAccent"
              : "designMuted"
        }
        variant="labelXXs/medium"
        className="shrink"
      >
        {label}
      </Text>
    </View>
  );
}
