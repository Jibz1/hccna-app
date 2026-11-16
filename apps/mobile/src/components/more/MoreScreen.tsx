import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { Suspense } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";

import { ConnectionResources } from "@/components/connect/ConnectionResources";
import { CCBForm } from "@/components/forms/CCBForms";
import { AnimatedHeader } from "@/components/layout/AnimatedHeader";
import { BodyScrollView } from "@/components/layout/BodyScrollView";
import { screenSpacing } from "@/components/layout/tabScreenLayout";
import { useTabScreenLayout } from "@/components/layout/useTabScreenLayout";
import { AppSection } from "@/components/more/AppSection";
import { MorePreferences } from "@/components/more/MorePreferences";
import { MoreRow, MoreSection } from "@/components/more/MoreSection";
import { Profile, ProfileDepartments } from "@/components/profile/Profile";
import { WordOfActivation } from "@/components/profile/WordOfActivation";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useMinistryToolsAccess } from "@/hooks/relay/useMinistryToolsAccess";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

function MinistryTools() {
  const router = useRouter();
  const { hasAccess } = useMinistryToolsAccess();
  if (!hasAccess) {
    return null;
  }

  return (
    <MoreSection title="Ministry">
      <MoreRow
        title="Ministry tools"
        subtitle="Tools for your team"
        icon="toolbox"
        last
        onPress={() => {
          router.navigate("/ministry-tools");
        }}
      />
    </MoreSection>
  );
}

export default function MoreScreen() {
  const layout = useTabScreenLayout(screenSpacing.wideGutter);
  const router = useRouter();
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const user = useUserProfile();
  const { width, onLayout } = useContainerWidth();
  const { fontScale } = useWindowDimensions();
  const twoColumns = width >= 768 && fontScale < 1.5;
  const columnClassName = twoColumns
    ? "gap-7"
    : "w-full max-w-135 gap-7 self-center";
  const columnStyle = twoColumns ? { width: (width - 28) / 2 } : undefined;
  const rowClassName = cn("gap-7", twoColumns && "flex-row items-stretch");

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
            <View onLayout={onLayout} className="w-full max-w-256 gap-7">
              <View
                className={cn(
                  "gap-2 pb-1",
                  !twoColumns && "w-full max-w-135 self-center",
                )}
              >
                <View className="flex-row items-center justify-between gap-3">
                  <Text
                    accessibilityRole="header"
                    variant="headingXl/bold"
                    color="designPrimary"
                  >
                    More
                  </Text>
                  {Platform.OS === "ios" && Platform.isPad ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Open More menu"
                      onPress={() => {
                        router.navigate("/more-menu");
                      }}
                      className="bg-design-surface active:bg-design-selected min-h-11 flex-row items-center gap-2 rounded-full px-4"
                    >
                      <FontAwesome6
                        name="ellipsis"
                        size={18}
                        color={colors.text}
                      />
                      <Text variant="body/medium" color="designPrimary">
                        Menu
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text variant="body/regular" color="designMuted">
                  Your church, beyond Sunday.
                </Text>
              </View>
              <View className={rowClassName}>
                <View className={columnClassName} style={columnStyle}>
                  <Profile
                    className={twoColumns ? "grow justify-center" : undefined}
                  />
                </View>
                {user ? (
                  <View className={columnClassName} style={columnStyle}>
                    <WordOfActivation
                      className={twoColumns ? "grow" : undefined}
                    />
                  </View>
                ) : null}
              </View>
              <View className={rowClassName}>
                <View className={columnClassName} style={columnStyle}>
                  <MorePreferences />
                </View>
                <View className={columnClassName} style={columnStyle}>
                  <ConnectionResources />
                </View>
              </View>
              <View className={rowClassName}>
                <View className={columnClassName} style={columnStyle}>
                  <CCBForm />
                  {user ? <ProfileDepartments /> : null}
                </View>
                <View className={columnClassName} style={columnStyle}>
                  {user ? (
                    <ErrorBoundaryWithRetry
                      key={user.uid}
                      fallbackRender={() => null}
                    >
                      <Suspense fallback={null}>
                        <MinistryTools />
                      </Suspense>
                    </ErrorBoundaryWithRetry>
                  ) : null}
                  <AppSection />
                </View>
              </View>
            </View>
          </BodyScrollView>
        )}
      </AnimatedHeader>
    </View>
  );
}
