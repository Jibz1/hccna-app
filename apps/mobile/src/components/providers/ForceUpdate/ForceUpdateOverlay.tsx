import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { StatusBar } from "expo-status-bar";
import type { ComponentProps } from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import SplashImage from "@/../assets/images/icon.png";
import { SignInAction } from "@/components/auth/SignInAction";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Image } from "@/ui/Image";
import { Text } from "@/ui/Text";

import type { ForceUpdateConfig, UpdateType } from "./constants";

type ForceUpdateOverlayProps = {
  config: Pick<
    ForceUpdateConfig,
    "title" | "message" | "updateButtonText" | "dismissButtonText" | "changelog"
  >;
  updateType: UpdateType;
  onUpdate: () => void;
  onDismiss: () => void;
  /** Update button icon; defaults to the store link icon. */
  actionIcon?: ComponentProps<typeof FontAwesome6>["name"];
  /** Line above the update button; defaults by update type, null hides it. */
  readyNote?: string | null;
  /** Line under the buttons; defaults to the store that opens. */
  footnote?: string;
};

export function ForceUpdateOverlay({
  config,
  updateType,
  onUpdate,
  onDismiss,
  actionIcon = "arrow-up-right-from-square",
  readyNote,
  footnote,
}: ForceUpdateOverlayProps) {
  const isSoftUpdate = updateType === "soft";
  const { colors, isDark, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();
  const storeName = Platform.OS === "ios" ? "App Store" : "Google Play";
  const note =
    readyNote === undefined
      ? isSoftUpdate
        ? "Update whenever you’re ready."
        : "Please update to continue using HCC."
      : readyNote;

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={() => {
        if (isSoftUpdate) {
          onDismiss();
        }
      }}
    >
      <StatusBar style={isDark ? "light" : "dark"} />
      <View accessibilityViewIsModal className="bg-design-background flex-1">
        <LinearGradient
          pointerEvents="none"
          colors={backgroundGradient}
          locations={backgroundGradientLocations}
          className="absolute inset-0"
        />
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="grow items-center px-xs"
          contentContainerStyle={{
            paddingTop: insets.top + 24,
            paddingBottom: 24,
          }}
        >
          <View className="gap-xs w-full max-w-[480px] grow">
            <View className="gap-5xs items-center">
              <Text
                color="designMuted"
                variant="caption/bold"
                className="tracking-[2px]"
              >
                HCC COMMUNITY
              </Text>
            </View>
            <View className="gap-xs items-center">
              <View
                accessible={false}
                className="border-design-border bg-design-surface h-[144px] w-[144px] items-center justify-center rounded-full border"
              >
                <View className="border-continuous bg-design-surface-strong border-design-border h-[112px] w-[112px] items-center justify-center rounded-[32px] border">
                  <Image
                    accessible={false}
                    className="h-[88px] w-[88px] rounded-[22px]"
                    contentFit="contain"
                    src={SplashImage}
                  />
                </View>
                <View className="bg-design-accent border-design-background absolute right-[1px] bottom-[5px] h-[46px] w-[46px] items-center justify-center rounded-full border-[4px]">
                  <FontAwesome6
                    name="arrow-up"
                    size={19}
                    color={colors.background}
                  />
                </View>
              </View>
              <View className="gap-3xs items-center">
                <View className="bg-design-selected px-3xs py-5xs rounded-full">
                  <Text color="designAccent" variant="caption/bold">
                    {isSoftUpdate ? "NEW UPDATE" : "UPDATE REQUIRED"}
                  </Text>
                </View>
                <Text
                  accessibilityRole="header"
                  variant="headingSm/bold"
                  color="designPrimary"
                  centered
                >
                  {config.title}
                </Text>
                <Text
                  variant="body/regular"
                  color="designMuted"
                  centered
                  className="max-w-[380px] leading-[24px]"
                >
                  {config.message}
                </Text>
              </View>
            </View>
            {config.changelog && config.changelog.length > 0 ? (
              <View className="border-continuous bg-design-surface border-design-border gap-3xs p-2xs rounded-[28px] border">
                <Text variant="bodyLg/bold" color="designPrimary">
                  What&apos;s new
                </Text>
                {config.changelog.map((item, index) => (
                  <View
                    key={`${index}-${item}`}
                    className="gap-4xs flex-row items-start"
                  >
                    <View className="bg-design-selected mt-[2px] h-[22px] w-[22px] items-center justify-center rounded-full">
                      <FontAwesome6
                        name="check"
                        size={10}
                        color={colors.accent}
                      />
                    </View>
                    <Text
                      variant="pXs/regular"
                      color="designMuted"
                      className="flex-1 leading-[23px]"
                    >
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
        <View
          className="bg-design-chrome border-t-design-border px-xs pt-3xs items-center border-t"
          style={{ paddingBottom: Math.max(insets.bottom, 24) }}
        >
          <View className="gap-4xs w-full max-w-[480px]">
            {note ? (
              <Text color="designMuted" variant="caption/regular" centered>
                {note}
              </Text>
            ) : null}
            <SignInAction
              label={config.updateButtonText}
              onPress={onUpdate}
              icon=<FontAwesome6
                name={actionIcon}
                size={15}
                color={colors.background}
              />
            />
            {isSoftUpdate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={config.dismissButtonText}
                onPress={onDismiss}
                className="px-3xs py-4xs min-h-[48px] items-center justify-center active:opacity-60"
              >
                <Text variant="pXs/medium" color="designPrimary" centered>
                  {config.dismissButtonText}
                </Text>
              </Pressable>
            ) : null}
            <Text color="designMuted" variant="caption/regular" centered>
              {footnote ?? `Opens ${storeName}`}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}
