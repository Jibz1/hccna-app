import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useIsFocused } from "expo-router";
import { useEffect } from "react";
import { Platform, View } from "react-native";

import { SignInAction } from "@/components/auth/SignInAction";
import { DetailModalLayout } from "@/components/layout/DetailModalLayout";
import { useForceUpdate } from "@/components/providers/ForceUpdate";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { DevicePrefs } from "@/utils/devicePrefs";
import { goBackOrReplace } from "@/utils/navigation";

import { isReleaseUnseen } from "./releaseNotes";
import { useWhatsNewRelease } from "./useWhatsNewRelease";

export function WhatsNewScreen() {
  const { colors } = useAppTheme();
  const isFocused = useIsFocused();
  const { isUpdateRequired } = useForceUpdate();
  const { release } = useWhatsNewRelease();

  useEffect(() => {
    if (
      Platform.OS !== "web" &&
      isFocused &&
      !isUpdateRequired &&
      release &&
      isReleaseUnseen(release, DevicePrefs.ensure().whatsNewLastSeenVersion)
    ) {
      // Record only once the screen is visible, including manual visits.
      // Native back and swipe-to-dismiss then behave just like the Done button.
      DevicePrefs.update({ whatsNewLastSeenVersion: release.version });
    }
  }, [isFocused, isUpdateRequired, release]);

  return (
    <DetailModalLayout
      title="What’s New"
      closeLabel="Close What’s New"
      testID="whats-new-screen"
    >
      <View className="w-full max-w-[540px] gap-8 self-center px-6 pb-2">
        <View className="items-center gap-5 pt-3">
          <View
            accessible={false}
            className="bg-design-selected h-20 w-20 items-center justify-center rounded-[28px]"
          >
            <FontAwesome6 name="gift" size={32} color={colors.accent} />
          </View>
          {release ? (
            <View className="bg-design-surface border-design-border rounded-full border px-4 py-2">
              <Text variant="caption/bold" color="designAccent">
                {`VERSION ${release.version}`}
              </Text>
            </View>
          ) : null}
          <View className="gap-3">
            <Text
              accessibilityRole="header"
              variant="headingSm/bold"
              color="designPrimary"
              centered
            >
              {release?.title ?? "You’re all caught up"}
            </Text>
            <Text variant="body/regular" color="designMuted" centered>
              {release?.description ??
                "New features and improvements will appear here with future releases."}
            </Text>
          </View>
        </View>
        {release ? (
          <View className="gap-6">
            {release.highlights.map((highlight) => (
              <View
                key={highlight.title}
                className="flex-row items-start gap-4"
              >
                <View
                  accessible={false}
                  className="bg-design-surface border-design-border h-12 w-12 items-center justify-center rounded-2xl border"
                >
                  <FontAwesome6
                    name={
                      FontAwesome6.hasIcon(highlight.icon, "solid") ||
                      FontAwesome6.hasIcon(highlight.icon, "regular")
                        ? highlight.icon
                        : "gift"
                    }
                    size={20}
                    color={colors.accent}
                  />
                </View>
                <View className="flex-1 gap-2">
                  <Text
                    accessibilityRole="header"
                    variant="body/medium"
                    color="designPrimary"
                  >
                    {highlight.title}
                  </Text>
                  <Text variant="pXs/regular" color="designMuted">
                    {highlight.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <View className="gap-4">
          <SignInAction
            label="Done"
            onPress={() => {
              goBackOrReplace();
            }}
          />
          <Text variant="caption/regular" color="designMuted" centered>
            Thank you for being part of the HCC family.
          </Text>
        </View>
      </View>
    </DetailModalLayout>
  );
}
