import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useMount, useObservable, useValue } from "@legendapp/state/react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SignInAction } from "@/components/auth/SignInAction";
import { SignInCodeEmailForm } from "@/components/auth/SignInCodeEmailForm";
import { SignInWithCode } from "@/components/auth/SignInWithCode";
import { DynamicKeyboardAvoidingView } from "@/components/layout/DynamicKeyboardAvoidingView";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useSendSignInCode } from "@/hooks/auth/useCodeSigninMutation";
import { useVerifySignInWithCode } from "@/hooks/auth/useCodeVerificationMutation";
import {
  useCreateOrSignInGoogleAccountMutation,
  useCreateOrSignInAppleAccountMutation,
} from "@/hooks/auth/useCreateAccountMutation";
import SvgAppleLogoMono from "@/icons/AppleLogoMono";
import SvgGoogleLogoMono from "@/icons/GoogleLogoMono";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { DevicePrefs } from "@/utils/devicePrefs";
import { goBackOrReplace } from "@/utils/navigation";

function LoginAccountTab() {
  const {
    mutate: createOrSignInGoogleAccount,
    isPending,
    error,
  } = useCreateOrSignInGoogleAccountMutation();
  const {
    mutate: createOrSignInAppleAccount,
    isPending: isPendingApple,
    error: errorApple,
  } = useCreateOrSignInAppleAccountMutation();

  const {
    mutate: sendSignInCode,
    isPending: isPendingSendSignInCode,
    error: errorSendSignInCode,
  } = useSendSignInCode();

  const {
    mutateAsync: verifySignInCode,
    isPending: isInFlightVerifySignInCode,
  } = useVerifySignInWithCode();
  const email$ = useObservable<string | null>(null);
  const email = useValue(email$);

  const { colors } = useAppTheme();
  const isBusy =
    isPending ||
    isPendingApple ||
    isPendingSendSignInCode ||
    isInFlightVerifySignInCode;
  const signInError = error ?? errorApple ?? errorSendSignInCode;
  const onSignedIn = () => {
    toast.success({ title: "Logged in successfully!" });
    goBackOrReplace("/more");
  };

  return (
    <View className="gap-3xs">
      <View className="border-continuous p-2xs bg-design-surface gap-[22px] rounded-[28px]">
        <View className="gap-4xs">
          <SignInAction
            secondary
            label="Continue with Google"
            icon=<SvgGoogleLogoMono
              width={20}
              height={20}
              color={colors.text}
            />
            loading={isPending}
            disabled={isBusy}
            onPress={() => {
              createOrSignInGoogleAccount(undefined, { onSuccess: onSignedIn });
            }}
          />
          {Platform.OS === "ios" ? (
            <SignInAction
              secondary
              label="Continue with Apple"
              icon=<SvgAppleLogoMono
                width={20}
                height={20}
                color={colors.text}
              />
              loading={isPendingApple}
              disabled={isBusy}
              onPress={() => {
                createOrSignInAppleAccount(undefined, {
                  onSuccess: onSignedIn,
                  onError: (error) => {
                    toast.error({
                      title: "Error logging in",
                      message: error.message,
                    });
                  },
                });
              }}
            />
          ) : null}
        </View>
        <View className="gap-4xs flex-row items-center">
          <View
            style={{
              height: StyleSheet.hairlineWidth,
            }}
            className="bg-design-border flex-1"
          />
          <Text color="designMuted" variant="caption/regular">
            or continue with email
          </Text>
          <View
            style={{
              height: StyleSheet.hairlineWidth,
            }}
            className="bg-design-border flex-1"
          />
        </View>
        {email ? (
          <SignInWithCode
            onSubmit={(data) =>
              verifySignInCode(
                { email, code: data.code },
                {
                  onError: (error) => {
                    toast.error({
                      title: "Error verifying sign in code",
                      message: error.message,
                    });
                  },
                },
              )
            }
            onVerified={() => {
              toast.success({
                title: "Sign in code verified! You are now logged in",
              });
              goBackOrReplace("/more");
            }}
            isPending={isBusy}
          />
        ) : (
          <SignInCodeEmailForm
            onSubmit={(data) => {
              sendSignInCode(
                { email: data.email },
                {
                  onSuccess: () => {
                    toast.success({
                      title:
                        "Sign in code sent! Check your email for a sign in link",
                    });
                    email$.set(data.email);
                  },
                },
              );
            }}
            submitting={isPendingSendSignInCode}
            disabled={isBusy}
          />
        )}
      </View>
      {signInError ? (
        <View
          accessibilityRole="alert"
          className="p-3xs bg-design-surface rounded-[18px]"
        >
          <Text
            selectable
            className="leading-[21px]"
            color="designPrimary"
            variant="pXs/regular"
          >
            {signInError.message}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AccountModal() {
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();
  useMount(() => {
    DevicePrefs.clearSignInWithCodeEmail();
  });

  return (
    <View className="bg-design-background flex-1">
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <DynamicKeyboardAvoidingView>
        <View
          style={{
            paddingTop: Math.max(insets.top, 14),
          }}
          className="pb-4xs items-center px-[22px]"
        >
          <View className="w-full max-w-[540px] flex-row items-center">
            <View className="w-[44px]" />
            <Text
              accessibilityRole="header"
              className="flex-1"
              color="designPrimary"
              variant="bodyLg/bold"
              centered
            >
              Login
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close login"
              onPress={() => {
                goBackOrReplace("/profile");
              }}
              className="bg-design-surface h-[44px] w-[44px] items-center justify-center rounded-[22px] active:opacity-60"
            >
              <FontAwesome6 name="xmark" size={18} color={colors.text} />
            </Pressable>
          </View>
        </View>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 32,
          }}
          contentContainerClassName="grow px-[22px] items-center"
        >
          <View className="w-full max-w-[540px] gap-[22px]">
            <View className="items-center gap-[10px] pt-[34px] pb-[10px]">
              <Text
                accessibilityRole="header"
                color="designPrimary"
                variant="screenTitle/bold"
                centered
              >
                Make yourself at home
              </Text>
              <Text
                className="max-w-[320px] leading-[21px]"
                color="designMuted"
                variant="pXs/regular"
                centered
              >
                Get connected and take the next step in your faith journey.
              </Text>
            </View>
            <LoginAccountTab />
            <Text
              className="px-3xs leading-[20px]"
              color="designMuted"
              variant="caption/regular"
              centered
            >
              Use the same email you use with CCB for a unified experience.
            </Text>
          </View>
        </ScrollView>
      </DynamicKeyboardAvoidingView>
    </View>
  );
}
