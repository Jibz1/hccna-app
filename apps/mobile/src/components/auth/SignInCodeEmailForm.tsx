import { Controller } from "react-hook-form";
import { TextInput, View } from "react-native";

import { SignInAction } from "@/components/auth/SignInAction";
import { useZodForm } from "@/hooks/utils/useZodForm";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

import {
  type FormValues,
  signInCodeEmailSchema,
} from "./SignInCodeEmailForm.schema";

export function SignInCodeEmailForm({
  onSubmit,
  submitting = false,
  disabled = false,
}: {
  onSubmit: (data: FormValues) => void;
  submitting?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const form = useZodForm({
    mode: "onChange",
    schema: signInCodeEmailSchema,
    defaultValues: { email: "" },
  });
  const {
    formState: { isSubmitting, isValid },
    handleSubmit,
  } = form;
  const isLoading = isSubmitting || submitting;
  const submit = handleSubmit(onSubmit);

  return (
    <View className="gap-3xs w-full">
      <Controller
        control={form.control}
        name="email"
        render={({ field: { onChange, onBlur, value, ref }, fieldState }) => (
          <View className="gap-5xs">
            <View className="px-3xs pt-4xs pb-6xs gap-6xs bg-design-surface-strong border-design-border rounded-[18px] border">
              <Text color="designMuted" variant="caption/regular">
                Email address
              </Text>
              <TextInput
                ref={ref}
                accessibilityLabel="Email address"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                onSubmitEditing={() => {
                  if (isValid && !disabled && !isLoading) {
                    void submit();
                  }
                }}
                editable={!disabled && !isLoading}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                selectionColor={colors.accent}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                className="py-5xs text-body-lg text-design-text min-h-[42px] px-0"
              />
            </View>
            {fieldState.error &&
            (fieldState.isTouched || value.includes("@")) ? (
              <Text
                selectable
                accessibilityRole="alert"
                color="designAccent"
                variant="labelXXs/regular"
              >
                {fieldState.error.message}
              </Text>
            ) : null}
          </View>
        )}
      />
      <Text
        className="leading-[20px]"
        color="designMuted"
        variant="caption/regular"
      >
        You&apos;ll receive a code to securely access your account.
      </Text>
      <SignInAction
        label="Send sign-in code"
        disabled={!isValid || disabled}
        loading={isLoading}
        onPress={() => {
          void submit();
        }}
      />
    </View>
  );
}
