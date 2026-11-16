import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DynamicKeyboardAvoidingView } from "@/components/layout/DynamicKeyboardAvoidingView";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";

export function DeleteAccountLayout({
  step,
  busy = false,
  children,
}: {
  step: 1 | 2;
  busy?: boolean;
  children: ReactNode;
}) {
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View className="bg-design-background flex-1">
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <DynamicKeyboardAvoidingView>
        <View
          style={{ paddingTop: Math.max(insets.top, 14) }}
          className="px-2xs pb-4xs flex-row items-center"
        >
          <View className="w-[44px]" />
          <Text
            className="flex-1"
            color="designPrimary"
            variant="bodyLg/bold"
            centered
          >
            Delete account
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close account deletion"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => {
              goBackOrReplace("/profile");
            }}
            className="bg-design-surface h-[44px] w-[44px] items-center justify-center rounded-full active:opacity-60"
          >
            <FontAwesome6 name="xmark" size={18} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="grow items-center px-xs"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }}
        >
          <View className="gap-2xs pt-2xs w-full max-w-[480px] grow">
            <View className="gap-4xs flex-row items-center justify-center">
              <View className="bg-design-accent h-[3px] w-[28px] rounded-full" />
              <View
                className={
                  step === 2
                    ? "bg-design-accent h-[3px] w-[28px] rounded-full"
                    : "bg-design-border h-[3px] w-[28px] rounded-full"
                }
              />
              <Text color="designMuted" variant="caption/medium">
                Step {step} of 2
              </Text>
            </View>
            {children}
          </View>
        </ScrollView>
      </DynamicKeyboardAvoidingView>
    </View>
  );
}

export function KeepAccountAction({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Keep my account"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        goBackOrReplace("/profile");
      }}
      className="px-3xs py-4xs min-h-[48px] items-center justify-center active:opacity-60"
    >
      <Text color="designPrimary" variant="pXs/medium" centered>
        Keep my account
      </Text>
    </Pressable>
  );
}
