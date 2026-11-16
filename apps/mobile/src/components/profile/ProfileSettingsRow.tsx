import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

export function ProfileSettingsRow({
  title,
  icon,
  value,
  onPress,
  last = false,
  destructive = false,
  busy = false,
  expanded,
}: {
  title: string;
  icon: ComponentProps<typeof FontAwesome6>["name"];
  value?: string;
  onPress: () => void;
  last?: boolean;
  destructive?: boolean;
  busy?: boolean;
  expanded?: boolean;
}) {
  const { colors, isDark } = useAppTheme();
  const color = destructive ? (isDark ? "#FFB4AB" : "#A33A32") : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityValue={
        value
          ? {
              text: value,
            }
          : undefined
      }
      accessibilityState={{
        disabled: busy,
        busy,
        expanded,
      }}
      disabled={busy}
      onPress={onPress}
      className="gap-3xs flex-row items-center pl-[22px] active:opacity-60"
    >
      <View className="w-xs items-center">
        <FontAwesome6
          name={icon}
          size={19}
          color={destructive ? color : colors.textMuted}
        />
      </View>
      <View
        style={{
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        }}
        className="gap-4xs border-b-design-border min-h-[66px] flex-1 flex-row items-center py-[18px] pr-[22px]"
      >
        <Text
          color={destructive ? "designNegative" : "designPrimary"}
          className="flex-1"
          variant="bodyLg/medium"
        >
          {title}
        </Text>
        {value ? (
          <Text
            color="designMuted"
            variant="pXs/regular"
            numberOfLines={2}
            className="max-w-[55%] shrink"
          >
            {value}
          </Text>
        ) : null}
        {busy ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <FontAwesome6
            name={expanded ? "chevron-down" : "chevron-right"}
            size={13}
            color={colors.textMuted}
          />
        )}
      </View>
    </Pressable>
  );
}
