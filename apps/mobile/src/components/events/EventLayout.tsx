import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";

export function EventLayout({
  title,
  showTitle = true,
  children,
}: {
  title: string;
  showTitle?: boolean;
  children: ReactNode;
}) {
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();
  const titleStyle = useAnimatedStyle(() => ({
    opacity: withTiming(showTitle ? 1 : 0, { duration: 140 }),
  }));

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
        className="w-full max-w-170 flex-1 self-center"
      >
        <View
          style={{
            paddingTop: Platform.OS === "ios" ? 12 : Math.max(insets.top, 12),
          }}
          className="flex-row items-center justify-between gap-3 px-5 pb-2"
        >
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden={!showTitle}
            importantForAccessibility={
              showTitle ? "auto" : "no-hide-descendants"
            }
            style={titleStyle}
            className="min-w-0 flex-1"
          >
            <Text
              accessibilityRole="header"
              variant="bodyLg/medium"
              color="designPrimary"
              numberOfLines={2}
            >
              {title}
            </Text>
          </Animated.View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close event details"
            onPress={() => {
              goBackOrReplace("/(tabs)/events");
            }}
            className="border-design-border bg-design-surface active:bg-design-selected h-11 w-11 items-center justify-center rounded-full border"
          >
            <FontAwesome6 name="xmark" size={18} color={colors.text} />
          </Pressable>
        </View>
        {children}
      </View>
    </View>
  );
}

export function EventEmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View className="border-continuous border-design-border bg-design-surface items-center gap-3 rounded-[24px] border px-6 py-9">
      <View className="bg-design-selected h-14 w-14 items-center justify-center rounded-full">
        <FontAwesome6 name="calendar-days" size={22} color={colors.accent} />
      </View>
      <Text variant="title/medium" color="designPrimary" centered>
        {title}
      </Text>
      <Text variant="body/regular" color="designMuted" centered>
        {message}
      </Text>
    </View>
  );
}
