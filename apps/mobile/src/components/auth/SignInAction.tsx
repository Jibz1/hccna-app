import type { ReactNode } from "react";
import { ActivityIndicator, Pressable } from "react-native";

import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export function SignInAction({
  label,
  onPress,
  disabled = false,
  loading = false,
  secondary = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  secondary?: boolean;
  icon?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const foreground = secondary ? colors.text : colors.background;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled: disabled || loading,
        busy: loading,
      }}
      disabled={disabled || loading}
      onPress={onPress}
      className={cn(
        "active:opacity-70 w-full min-h-[54px] rounded-[28px] border flex-row items-center justify-center gap-4xs px-2xs py-[14px]",
        secondary ? "bg-design-surface-strong" : "bg-design-text",
        secondary ? "border-design-border" : "border-transparent",
        disabled && !loading ? "opacity-45" : "opacity-100",
      )}
    >
      {loading ? <ActivityIndicator color={foreground} /> : icon}
      <Text
        className="shrink"
        color={secondary ? "designPrimary" : "designBackground"}
        variant="pSm/bold"
        centered
      >
        {label}
      </Text>
    </Pressable>
  );
}
