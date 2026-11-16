import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { addMinutes } from "date-fns";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import {
  DeleteAccountLayout,
  KeepAccountAction,
} from "@/components/auth/DeleteAccountLayout";
import { SignInAction } from "@/components/auth/SignInAction";
import { useRequestDeleteAccount } from "@/hooks/auth/useRequestDeleteAccount";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { DevicePrefs } from "@/utils/devicePrefs";

export default function DeleteAccountScreen() {
  const user = useUserProfile();
  const { colors, isDark } = useAppTheme();
  const { requestDeleteAccount } = useRequestDeleteAccount();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = user?.email;

  const sendCode = async () => {
    if (!email || isSending) {
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      await requestDeleteAccount({});
      DevicePrefs.update({
        deleteAccountRequest: {
          email,
          expiresTimestampMs: addMinutes(Date.now(), 10).getTime(),
        },
      });
      router.replace("/delete-account-confirmation");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to send a code. Please try again.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <DeleteAccountLayout step={1} busy={isSending}>
      <View className="gap-3xs items-center">
        <View className="bg-design-negative/10 h-[76px] w-[76px] items-center justify-center rounded-full">
          <FontAwesome6
            name="trash-can"
            size={28}
            color={isDark ? "#FFB4AB" : "#A33A32"}
          />
        </View>
        <Text
          accessibilityRole="header"
          color="designPrimary"
          variant="headingSm/bold"
          centered
        >
          Delete your account?
        </Text>
        <Text
          color="designMuted"
          variant="body/regular"
          centered
          className="max-w-[360px] leading-[23px]"
        >
          Before you go, here&apos;s what this means for your HCC account.
        </Text>
      </View>
      <View className="border-continuous bg-design-surface border-design-border gap-2xs p-2xs rounded-[28px] border">
        <View className="gap-3xs flex-row items-start">
          <FontAwesome6 name="user-minus" size={18} color={colors.textMuted} />
          <View className="gap-6xs flex-1">
            <Text color="designPrimary" variant="body/medium">
              Your account will be removed
            </Text>
            <Text
              color="designMuted"
              variant="pXs/regular"
              className="leading-[21px]"
            >
              You&apos;ll be signed out and lose access to this account.
            </Text>
          </View>
        </View>
        <View className="bg-design-border h-px" />
        <View className="gap-3xs flex-row items-start">
          <FontAwesome6
            name="arrow-rotate-left"
            size={18}
            color={colors.textMuted}
          />
          <View className="gap-6xs flex-1">
            <Text color="designPrimary" variant="body/medium">
              This can&apos;t be undone
            </Text>
            <Text
              color="designMuted"
              variant="pXs/regular"
              className="leading-[21px]"
            >
              Your deleted account can&apos;t be restored.
            </Text>
          </View>
        </View>
      </View>
      <View className="gap-5xs items-center">
        <Text color="designMuted" variant="pXs/regular" centered>
          {email
            ? "We’ll send a confirmation code to"
            : "Sign in to request account deletion."}
        </Text>
        {email ? (
          <Text selectable color="designPrimary" variant="body/medium" centered>
            {email}
          </Text>
        ) : null}
        <Text color="designMuted" variant="caption/regular" centered>
          Your account stays active until you confirm.
        </Text>
      </View>
      <View className="gap-4xs pt-4xs mt-auto">
        {error ? (
          <Text
            accessibilityRole="alert"
            color="designNegative"
            variant="pXs/regular"
            centered
          >
            {error}
          </Text>
        ) : null}
        <SignInAction
          label={isSending ? "Sending code…" : "Send confirmation code"}
          loading={isSending}
          disabled={!email}
          onPress={() => {
            void sendCode();
          }}
        />
        <KeepAccountAction disabled={isSending} />
      </View>
    </DeleteAccountLayout>
  );
}
