import { View } from "react-native";

import { CampusGivingCards } from "@/components/giving/CampusGivingCards";
import { MyGiving } from "@/components/giving/MyGiving";
import { AnimatedHeader } from "@/components/layout/AnimatedHeader";
import { BodyScrollView } from "@/components/layout/BodyScrollView";
import { screenSpacing } from "@/components/layout/tabScreenLayout";
import { useTabScreenLayout } from "@/components/layout/useTabScreenLayout";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

export default function GivingScreen() {
  const layout = useTabScreenLayout(screenSpacing.gutter);
  const { backgroundGradient, backgroundGradientLocations } = useAppTheme();

  return (
    <View className="bg-design-background flex-1">
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <AnimatedHeader layout={layout}>
        {(scrollProps) => (
          <BodyScrollView
            {...scrollProps}
            showsVerticalScrollIndicator={false}
            contentContainerClassName="items-center"
          >
            <View className="w-full max-w-170 gap-7">
              <View className="gap-2">
                <Text
                  accessibilityRole="header"
                  variant="headingLg/bold"
                  color="designPrimary"
                >
                  Giving
                </Text>
                <Text variant="bodyLg/regular" color="designMuted">
                  A generous heart. A lasting impact.
                </Text>
              </View>
              <MyGiving variant="surface" />
              <CampusGivingCards />
              <Text
                variant="caption/regular"
                color="designMuted"
                centered
                className="px-3xs"
              >
                Thank you for helping our church love people and serve our
                community.
              </Text>
            </View>
          </BodyScrollView>
        )}
      </AnimatedHeader>
    </View>
  );
}
