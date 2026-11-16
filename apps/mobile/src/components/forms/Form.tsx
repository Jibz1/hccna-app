import { ReactNode, type ComponentProps } from "react";
import {
  FormProvider,
  useFormContext,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { View, ViewProps } from "react-native";

import SvgCheckStroke12 from "@/icons/CheckStroke16";
import { Alert, AlertMessage } from "@/ui/Alerts";
import { Text, type TextProps } from "@/ui/Text";

type FormProps<T extends FieldValues> = Omit<
  ComponentProps<"form">,
  "onSubmit"
> & {
  form: UseFormReturn<T>;
};

export function Form<T extends FieldValues>({ form, children }: FormProps<T>) {
  return <FormProvider {...form}>{children}</FormProvider>;
}

export function FormFieldError({
  name,
  showError = true,
}: {
  name: string;
  showError?: boolean;
}) {
  const { getFieldState, formState, getValues } = useFormContext();
  const { error } = getFieldState(name, formState);
  const fieldValue = getValues(name);

  const isFieldEmpty =
    fieldValue === undefined || fieldValue === null || fieldValue === "";
  const shouldShowError = !isFieldEmpty && formState.errors[name]?.message;
  if (!showError || !error || !shouldShowError) {
    return null;
  }

  return (
    <Alert variant="negative" rounded="xl">
      <AlertMessage>{error.message ?? "This field is required"}</AlertMessage>
    </Alert>
  );
}

export interface FormFieldProps extends ViewProps {
  name: string;
  label?: string;
  children: ReactNode;
  errorMessageLocation?: "before" | "after";
  noErrorMessage?: boolean;
  showError?: boolean;
  validMessage?: string;
  afterLabel?: ReactNode;
  labelColor?: TextProps["color"];
}

export function FormField({
  children,
  name,
  label,
  noErrorMessage,
  showError = true,
  validMessage,
  errorMessageLocation = "after",
  afterLabel,
  labelColor = "primary",
}: FormFieldProps) {
  const { formState } = useFormContext();
  const { errors, touchedFields, dirtyFields } = formState;

  // Note: isValid is not doing what we think it should do. Returns true when every field within the form is true
  // We need to check if the field is touched or dirty and there is no error
  const isFieldValid =
    !errors[name]?.message && (touchedFields[name] ?? dirtyFields[name]);
  return (
    <View className="gap-5xs w-full">
      <View className="flex-row items-center justify-between">
        {label && (
          <Text variant="labelXs/medium" color={labelColor}>
            {label}
          </Text>
        )}
        {afterLabel ?? null}
      </View>

      {!noErrorMessage && errorMessageLocation === "before" && (
        <FormFieldError name={name} showError={showError} />
      )}
      {children}
      {!noErrorMessage && errorMessageLocation === "after" && (
        <FormFieldError name={name} showError={showError} />
      )}
      {isFieldValid && validMessage && (
        <Alert variant="positive" rounded="xl" customIcon={SvgCheckStroke12}>
          <AlertMessage>{validMessage}</AlertMessage>
        </Alert>
      )}
    </View>
  );
}
