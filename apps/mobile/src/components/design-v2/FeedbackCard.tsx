import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export function FeedbackCard({
  title,
  message,
  icon,
  actionLabel = "Try again",
  onAction,
  disabled = false,
  className,
}: {
  title: string;
  message?: string;
  icon: ReactNode;
  actionLabel?: string;
  onAction: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <View
      className={cn(
        "border-continuous bg-design-surface border-design-border min-w-0 self-stretch gap-6 rounded-[28px] border p-6",
        className,
      )}
    >
      <View className="items-center gap-4">
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="bg-design-selected size-14 items-center justify-center rounded-[20px]"
        >
          {icon}
        </View>
        <View className="gap-2 self-stretch">
          <Text
            accessibilityRole="header"
            variant="titleLg/bold"
            color="designPrimary"
            centered
          >
            {title}
          </Text>
          {message ? (
            <Text variant="body/regular" color="designMuted" centered>
              {message}
            </Text>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onAction}
        className={cn(
          "bg-design-text min-h-14 items-center justify-center rounded-full px-5 py-4 active:opacity-70",
          disabled && "opacity-50",
        )}
      >
        <Text variant="body/medium" color="designBackground" centered>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}
