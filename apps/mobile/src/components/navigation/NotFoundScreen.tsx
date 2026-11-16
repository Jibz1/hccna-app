import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

export function NotFoundScreen({ onGoBack }: { onGoBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();

  return (
    <View testID="not-found-screen" className="bg-design-background flex-1">
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="grow items-center"
        contentContainerStyle={{
          paddingTop: insets.top + 28,
          paddingBottom: insets.bottom + 28,
          paddingLeft: insets.left + 24,
          paddingRight: insets.right + 24,
        }}
      >
        <Text
          variant="caption/medium"
          color="designAccent"
          className="tracking-[3px]"
        >
          HCCNA
        </Text>

        <View className="w-full max-w-[400px] grow items-center justify-center gap-8 py-12">
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="border-design-border size-44 items-center justify-center rounded-full border"
          >
            <View className="border-design-border bg-design-surface size-32 items-center justify-center rounded-full border">
              <FontAwesome6 name="compass" size={56} color={colors.accent} />
            </View>
            <View className="border-design-border bg-design-surface-strong absolute -bottom-2 rounded-full border px-5 py-2">
              <Text variant="caption/medium" color="designAccent">
                404
              </Text>
            </View>
          </View>

          <View className="w-full items-center gap-3 pt-2">
            <Text
              accessibilityRole="header"
              variant="headingLg/bold"
              color="designPrimary"
              centered
            >
              Unmatched Route
            </Text>
            <Text
              variant="bodyLg/regular"
              color="designMuted"
              centered
              className="max-w-[320px]"
            >
              Page could not be found.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onGoBack}
            className="bg-design-text min-h-14 w-full flex-row items-center justify-center gap-3 rounded-full px-6 py-4 active:opacity-70"
          >
            <FontAwesome6
              name="arrow-left"
              size={16}
              color={colors.background}
            />
            <Text variant="bodyLg/medium" color="designBackground" centered>
              Go back
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
