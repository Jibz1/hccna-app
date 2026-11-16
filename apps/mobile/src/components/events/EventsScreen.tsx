import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Suspense } from "react";
import { View } from "react-native";
import { useSharedValue } from "react-native-reanimated";

import { LatestEvents } from "@/components/events/LatestEvents";
import { AnimatedHeader } from "@/components/layout/AnimatedHeader";
import { BodyScrollView } from "@/components/layout/BodyScrollView";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { useTabScreenLayout } from "@/components/layout/useTabScreenLayout";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

const latestEventsFallback = (
  <View className="py-10">
    <FullLoadingState />
  </View>
);

export default function EventsScreen() {
  const layout = useTabScreenLayout();
  const campus = usePreferredCampus();
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const scrollY = useSharedValue(0);

  return (
    <View className="bg-design-background flex-1">
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <AnimatedHeader scrollY={scrollY} layout={layout}>
        {(scrollProps) => (
          <BodyScrollView
            {...scrollProps}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            contentContainerClassName="items-center"
          >
            <View className="w-full max-w-256 gap-6">
              <View className="flex-row items-center justify-between gap-4 px-5">
                <View className="flex-1 gap-1">
                  <Text
                    accessibilityRole="header"
                    variant="headingLg/bold"
                    color="designPrimary"
                    className="tracking-[-1.2px]"
                  >
                    Events
                  </Text>
                  <View
                    accessible
                    accessibilityLabel={`Events for ${campus.campusName}`}
                    className="bg-design-selected mt-1 max-w-full flex-row items-center gap-2 self-start rounded-full px-3 py-1.5"
                  >
                    <FontAwesome6
                      name="location-dot"
                      size={12}
                      color={colors.accent}
                    />
                    <Text
                      variant="caption/medium"
                      color="designAccent"
                      className="shrink"
                    >
                      {campus.campusName}
                    </Text>
                  </View>
                </View>
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  className="border-continuous border-design-border bg-design-surface h-14 w-14 items-center justify-center rounded-[20px] border"
                >
                  <FontAwesome6
                    name="calendar-days"
                    size={23}
                    color={colors.accent}
                  />
                </View>
              </View>
              <ErrorBoundaryWithRetry
                key={campus.slug}
                title="Unable to load events"
                subtitle="Please try again later"
                fallbackClassName="mx-5"
              >
                <Suspense fallback={latestEventsFallback}>
                  <LatestEvents campusSlug={campus.slug} />
                </Suspense>
              </ErrorBoundaryWithRetry>
            </View>
          </BodyScrollView>
        )}
      </AnimatedHeader>
    </View>
  );
}
