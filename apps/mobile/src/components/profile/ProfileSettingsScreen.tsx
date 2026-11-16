import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DeleteAccountButton } from "@/components/auth/DeleteAccountButton";
import { Logout } from "@/components/auth/Logout";
import { AccountAvatarImage } from "@/components/profile/AccountAvatar";
import { ProfileSettingsRow } from "@/components/profile/ProfileSettingsRow";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import { useAuthenticatedUid, useUserProfile } from "@/hooks/relay/useUserData";
import { AppearancePreference } from "@/theme/AppearancePreference";
import { useAppTheme } from "@/theme/useAppTheme";
import { usePreferencesTheme } from "@/theme/usePreferencesTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";

export function ProfileSettingsScreen() {
  const router = useRouter();
  const user = useUserProfile();
  const uid = useAuthenticatedUid();
  const campus = usePreferredCampus();
  const preference = usePreferencesTheme();
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();
  const [appearanceExpanded, setAppearanceExpanded] = useState(false);
  const appearance =
    preference === "auto"
      ? "System"
      : preference === "purple-dark"
        ? "Dark"
        : "Light";
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const openAccount = () => {
    router.push(user ? "/edit-profile" : "/account-modal-stack");
  };

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
              accessibilityLabel="Back from profile"
              onPress={() => {
                goBackOrReplace("/");
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
              Profile
            </Text>
            <View className="w-[44px]" />
          </View>
          <View className="pb-s items-center gap-[10px] pt-[34px]">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={user ? "Edit profile" : "Sign in"}
              onPress={openAccount}
              className="mb-4xs active:opacity-70"
            >
              <View className="bg-design-surface rounded-[64px] p-[7px]">
                <AccountAvatarImage
                  isLoggedIn={Boolean(user)}
                  img={user?.img}
                  size={104}
                />
              </View>
              <View className="bg-design-surface-strong border-design-background absolute top-0 -right-[2px] h-[34px] w-[34px] items-center justify-center rounded-[17px] border-2">
                <FontAwesome6 name="pen" size={13} color={colors.text} />
              </View>
            </Pressable>
            <Text
              selectable
              color="designPrimary"
              variant="screenTitle/bold"
              centered
            >
              {name || "Your profile"}
            </Text>
            <Text selectable color="designMuted" variant="pXs/regular" centered>
              {user?.email ?? "Make yourself at home"}
            </Text>
            {user?.phone ? (
              <Text
                selectable
                color="designMuted"
                variant="pXs/regular"
                centered
              >
                {user.phone}
              </Text>
            ) : null}
          </View>
          <View className="border-continuous bg-design-surface overflow-hidden rounded-[28px]">
            <ProfileSettingsRow
              title={user ? "Account" : "Sign in or create an account"}
              icon="user"
              onPress={openAccount}
            />
            <ProfileSettingsRow
              title="Appearance"
              icon="palette"
              value={appearance}
              expanded={appearanceExpanded}
              onPress={() => {
                setAppearanceExpanded((expanded) => !expanded);
              }}
            />
            {appearanceExpanded ? (
              <View className="px-5xs pb-5xs">
                <AppearancePreference showTitle={false} />
              </View>
            ) : null}
            <ProfileSettingsRow
              title="Campus"
              icon="church"
              value={campus.campusName}
              last
              onPress={() => {
                router.push("/preferences");
              }}
            />
          </View>
          {uid ? (
            <View className="border-continuous bg-design-surface overflow-hidden rounded-[28px]">
              <Logout />
              <DeleteAccountButton />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
