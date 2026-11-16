import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { type ComponentProps, type ReactNode } from "react";
import { type LayoutChangeEvent, Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  StyledAnimatedScrollView,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";

export function DetailModalSection({ children }: { children: ReactNode }) {
  return (
    <View className="px-3xs w-full items-center">
      <View className="gap-2xs w-full">{children}</View>
    </View>
  );
}

export function DetailModalLayout({
  children,
  title,
  closeLabel,
  testID,
  keyboardAware = false,
  showTitle = true,
  onScroll,
  onContentLayout,
}: {
  children: ReactNode;
  title: string;
  closeLabel: string;
  testID?: string;
  keyboardAware?: boolean;
  showTitle?: boolean;
  onScroll?: ComponentProps<typeof StyledAnimatedScrollView>["onScroll"];
  onContentLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();
  const titleStyle = useAnimatedStyle(() => ({
    opacity: withTiming(showTitle ? 1 : 0, { duration: 140 }),
  }));

  return (
    <View
      testID={testID}
      className="bg-design-background flex-1"
      style={{ paddingLeft: insets.left, paddingRight: insets.right }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <View
        style={{ paddingTop: Math.max(insets.top, 14) }}
        className="px-2xs pb-4xs gap-4xs w-full max-w-170 flex-row items-center self-center"
      >
        <View className="w-11" />
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden={!showTitle}
          importantForAccessibility={showTitle ? "auto" : "no-hide-descendants"}
          style={titleStyle}
          className="min-w-0 flex-1"
        >
          <Text
            accessibilityRole="header"
            color="designPrimary"
            variant="bodyLg/bold"
            centered
          >
            {title}
          </Text>
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={() => {
            goBackOrReplace();
          }}
          className="bg-design-text border-design-accent/40 h-[44px] w-[44px] items-center justify-center rounded-[22px] border active:opacity-80"
        >
          <FontAwesome6 name="xmark" size={18} color={colors.background} />
        </Pressable>
      </View>
      <StyledAnimatedScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        automaticallyAdjustKeyboardInsets={keyboardAware}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        contentContainerClassName="grow items-center pt-2xs"
      >
        <View onLayout={onContentLayout} className="gap-2xs w-full max-w-170">
          {children}
        </View>
      </StyledAnimatedScrollView>
    </View>
  );
}
