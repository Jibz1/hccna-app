import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Redirect, useRouter } from "expo-router";
import { Suspense } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EventAttendances } from "@/components/events/EventAttendances";
import { ExportEventAttendance } from "@/components/events/ExportEventAttendance";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { StreamEditor } from "@/components/live/StreamEditor";
import { ProfileSettingsRow } from "@/components/profile/ProfileSettingsRow";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useMinistryToolsAccess } from "@/hooks/relay/useMinistryToolsAccess";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { HOUSE_OF_STARS_JUNIOR_CHURCH_SLUG } from "@/relay/campuses";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";

function MinistryToolsContent() {
  const { hasAccess, canCheckIn, canEditStream, canExportAttendance } =
    useMinistryToolsAccess();

  if (!hasAccess) {
    return <Redirect href="/more" />;
  }

  return (
    <>
      {canCheckIn ? <EventAttendances /> : null}
      {canEditStream ? (
        <StreamEditor campusSlug={HOUSE_OF_STARS_JUNIOR_CHURCH_SLUG} />
      ) : null}
      {canExportAttendance ? <ExportEventAttendance /> : null}
    </>
  );
}

export function MinistryToolsScreen() {
  const router = useRouter();
  const user = useUserProfile();
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
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 32,
        }}
        contentContainerClassName="grow px-[22px] items-center"
      >
        <View className="w-full max-w-[540px] gap-[22px]">
          <View className="flex-row items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back from Ministry Tools"
              onPress={() => {
                goBackOrReplace("/more");
              }}
              className="bg-design-surface h-[44px] w-[44px] items-center justify-center rounded-[22px] active:opacity-60"
            >
              <FontAwesome6 name="chevron-left" size={18} color={colors.text} />
            </Pressable>
            <Text
              accessibilityRole="header"
              className="flex-1"
              color="designPrimary"
              variant="bodyLg/bold"
              centered
            >
              Ministry Tools
            </Text>
            <View className="w-[44px]" />
          </View>
          <Text color="designMuted" variant="pXs/regular" className="px-4xs">
            {user
              ? "Your available tools for event check-ins, livestreams, and attendance reports."
              : "Sign in to access your ministry tools."}
          </Text>
          {user ? (
            <ErrorBoundaryWithRetry
              key={user.uid}
              title="Unable to load ministry tools"
              subtitle="Please try again later"
            >
              <Suspense fallback=<FullLoadingState />>
                <MinistryToolsContent />
              </Suspense>
            </ErrorBoundaryWithRetry>
          ) : (
            <View className="border-continuous bg-design-surface overflow-hidden rounded-[28px]">
              <ProfileSettingsRow
                title="Sign in or create an account"
                icon="user"
                last
                onPress={() => {
                  router.push("/account-modal-stack");
                }}
              />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
