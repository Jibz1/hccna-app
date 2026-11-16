import { Schema } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWatch } from "react-hook-form";
import { ActivityIndicator, Pressable, View } from "react-native";

import { SignInAction } from "@/components/auth/SignInAction";
import { CountDownTimer } from "@/components/events/CountDownTimer";
import { Form } from "@/components/forms/Form";
import { useSendSignInCode } from "@/hooks/auth/useCodeSigninMutation";
import { useOtpInputFocus } from "@/hooks/auth/useOtpInputFocus";
import { useOtpVerification } from "@/hooks/auth/useOtpVerification";
import { useZodForm } from "@/hooks/utils/useZodForm";
import { useAppTheme } from "@/theme/useAppTheme";
import { Alert, AlertMessage } from "@/ui/Alerts";
import { OtpInput } from "@/ui/OtpInput";
import { Text } from "@/ui/Text";
import { DevicePrefs } from "@/utils/devicePrefs";

const CODE_LENGTH = 6;

const signInWithCodeSchema = Schema.Struct({
  code: Schema.String.check(
    Schema.isMinLength(CODE_LENGTH, { message: "Code must be 6 digits" }),
    Schema.isMaxLength(CODE_LENGTH, { message: "Code must be 6 digits" }),
  ),
});

export type FormValues = typeof signInWithCodeSchema.Type;

type SignInWithCodeProps = {
  /** Verifies the code. Reject to show the error state. */
  onSubmit: (data: FormValues) => Promise<unknown>;
  /** Fires after a successful verification once the success animation played. */
  onVerified: () => void;
  isPending?: boolean;
};

export function SignInWithCode({
  onSubmit,
  onVerified,
  isPending = false,
}: SignInWithCodeProps) {
  const { colors } = useAppTheme();
  const form = useZodForm({
    mode: "onSubmit",
    schema: signInWithCodeSchema,
    defaultValues: {
      code: "",
    },
  });

  const {
    control,
    formState: { isSubmitting, isValid },
    handleSubmit,
    setValue,
  } = form;
  const code = useWatch({ control, name: "code" });

  const { status, submit, handleChange } = useOtpVerification({
    verify: (nextCode) => onSubmit({ code: nextCode }),
    onVerified,
  });

  const devicePrefs = useSyncExternalStore(
    DevicePrefs.subscribe,
    DevicePrefs.getSnapshot,
    DevicePrefs.getSnapshot,
  );
  const signInWithCodeEmail = devicePrefs.signInWithCodeEmail;
  const expiresTimestampMs = signInWithCodeEmail?.expiresTimestampMs;
  const [expiredTimestampMs, setExpiredTimestampMs] = useState<number | null>(
    () =>
      expiresTimestampMs && expiresTimestampMs <= Date.now()
        ? expiresTimestampMs
        : null,
  );

  useEffect(() => {
    if (!expiresTimestampMs) {
      return;
    }

    const delayMs = Math.max(expiresTimestampMs - Date.now(), 0);

    const timeout = setTimeout(() => {
      setExpiredTimestampMs(expiresTimestampMs);
    }, delayMs + 1);

    return () => {
      clearTimeout(timeout);
    };
  }, [expiresTimestampMs]);

  const {
    mutate: handleResendCode,
    isPending: isPendingSendSignInCode,
    error: errorSendSignInCode,
  } = useSendSignInCode();
  const isLoading = isSubmitting || isPendingSendSignInCode || isPending;
  const inputDisabled = isLoading || status === "success";
  const inputRef = useOtpInputFocus(!inputDisabled);
  const canVerify =
    !!expiresTimestampMs &&
    expiredTimestampMs !== expiresTimestampMs &&
    !isPendingSendSignInCode;

  const handleCodeChange = (nextCode: string) => {
    setValue("code", nextCode, { shouldValidate: true });
    handleChange(nextCode);
  };

  return (
    <View className="gap-3xs w-full">
      <Form form={form}>
        <View className="gap-3xs w-full">
          <Text
            variant="labelXs/medium"
            className="leading-[21px]"
            color="designPrimary"
            centered
          >
            Enter the code we&apos;ve sent to your email
          </Text>

          <OtpInput
            appearance="design"
            ref={inputRef}
            length={CODE_LENGTH}
            value={code}
            status={status}
            disabled={inputDisabled}
            onChange={handleCodeChange}
            onComplete={(completeCode) => {
              if (canVerify) {
                void submit(completeCode);
              }
            }}
          />
          {expiresTimestampMs ? (
            <View className="flex-row items-center justify-center">
              <CountDownTimer
                timestamp={expiresTimestampMs}
                variant="labelXs/bold"
                endLabel="Code expired. Please resend."
                color="designMuted"
              />
            </View>
          ) : null}
          {errorSendSignInCode ? (
            <Alert variant="negative" rounded="xl">
              <AlertMessage>
                {errorSendSignInCode?.message || "Something went wrong"}
              </AlertMessage>
            </Alert>
          ) : null}

          <View className="gap-4xs items-center">
            <Text color="designMuted" variant="caption/regular">
              Didn&apos;t receive a code?
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resend code"
              accessibilityState={{
                disabled: !signInWithCodeEmail?.email || inputDisabled,
                busy: isPendingSendSignInCode,
              }}
              disabled={!signInWithCodeEmail?.email || inputDisabled}
              className="gap-5xs px-3xs min-h-[44px] flex-row items-center justify-center active:opacity-60"
              onPress={() => {
                if (signInWithCodeEmail?.email) {
                  handleResendCode({
                    email: signInWithCodeEmail.email,
                  });
                }
              }}
            >
              {isPendingSendSignInCode ? (
                <ActivityIndicator color={colors.accent} />
              ) : null}
              <Text color="designAccent" variant="pXs/bold">
                Resend code
              </Text>
            </Pressable>
            <SignInAction
              label="Verify code"
              loading={isLoading}
              onPress={() => {
                void handleSubmit((data) => submit(data.code))();
              }}
              disabled={!canVerify || !isValid || status === "success"}
            />
          </View>
        </View>
      </Form>
    </View>
  );
}

SignInWithCode.displayName = "SignInWithCode";
