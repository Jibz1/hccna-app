import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

export function AttendanceLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View className="bg-design-background flex-1">
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <View
        style={{ paddingLeft: insets.left, paddingRight: insets.right }}
        className="w-full max-w-[600px] flex-1 self-center"
      >
        <View
          style={{
            paddingTop: Platform.OS === "ios" ? 16 : Math.max(insets.top, 16),
          }}
          className="flex-row items-center gap-3 px-5 pb-4"
        >
          <View className="w-11" />
          <Text
            accessibilityRole="header"
            variant="bodyLg/bold"
            color="designPrimary"
            centered
            className="flex-1"
          >
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${title.toLowerCase()}`}
            onPress={() => {
              goBackOrReplace("/ministry-tools");
            }}
            className="bg-design-text h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <FontAwesome6 name="xmark" size={18} color={colors.background} />
          </Pressable>
        </View>
        {children}
      </View>
    </View>
  );
}

export function AttendanceSelectionMark({ checked }: { checked: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      className={cn(
        "h-6 w-6 items-center justify-center rounded-[7px] border",
        checked
          ? "bg-design-accent border-design-accent"
          : "border-design-text-muted/40 bg-design-surface",
      )}
    >
      {checked ? (
        <FontAwesome6 name="check" size={12} color={colors.background} />
      ) : null}
    </View>
  );
}

export function AttendanceEmptyState({
  title,
  message,
  icon = "users",
}: {
  title: string;
  message: string;
  icon?: ComponentProps<typeof FontAwesome6>["name"];
}) {
  const { colors } = useAppTheme();
  return (
    <View className="items-center gap-3 px-6 py-10">
      <View className="bg-design-selected h-14 w-14 items-center justify-center rounded-[20px]">
        <FontAwesome6 name={icon} size={22} color={colors.accent} />
      </View>
      <Text variant="bodyLg/bold" color="designPrimary" centered>
        {title}
      </Text>
      <Text variant="body/regular" color="designMuted" centered>
        {message}
      </Text>
    </View>
  );
}

export function AttendanceFooter({
  label,
  summary,
  hint,
  disabled,
  loading,
  icon,
  onPress,
}: {
  label: string;
  summary: string;
  hint?: string;
  disabled: boolean;
  loading: boolean;
  icon: ComponentProps<typeof FontAwesome6>["name"];
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      className="border-design-border bg-design-chrome gap-3 border-t px-5 pt-4"
    >
      <Text variant="caption/medium" color="designMuted" centered>
        {summary}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled}
        onPress={onPress}
        className={cn(
          "border-continuous bg-design-text min-h-14 flex-row items-center justify-center gap-3 rounded-[20px] px-5 py-4 active:opacity-70",
          disabled && "opacity-50",
        )}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.background} />
        ) : (
          <FontAwesome6 name={icon} size={17} color={colors.background} />
        )}
        <Text variant="bodyLg/medium" color="designBackground">
          {label}
        </Text>
      </Pressable>
      {hint ? (
        <Text variant="captionSm/regular" color="designMuted" centered>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
