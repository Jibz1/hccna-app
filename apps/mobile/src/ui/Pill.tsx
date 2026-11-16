import { cva, VariantProps } from "class-variance-authority";
import { ReactNode } from "react";
import { Pressable, PressableProps, View } from "react-native";

import { Text, TextProps } from "@/ui/Text";

const pillVariants = cva(
  "py-5xs px-4xs flex-row items-center justify-center w-fit",
  {
    variants: {
      variant: {
        positive: "bg-background-positive-strong",
        warning: "bg-background-warning-strong",
        negative: "bg-background-negative-strong",
        action: "bg-action-secondary",
        brand: "bg-[#5d47a8]",
        bleedthrough: "bg-background-inverse-bleedthrough-medium",
        accentPrimary: "bg-background-accent",
        transparent: "bg-transparent",
      },
      rounded: {
        full: "rounded-full",
        xs: "rounded-xs",
        s: "rounded-sm",
        m: "rounded-m",
        lg: "rounded-lg",
      },
      size: {
        xs: "px-5xs py-6xs",
        md: "py-5xs px-4xs",
        lg: "px-4xs py-3xs",
      },
    },
    defaultVariants: {
      variant: "positive",
      rounded: "full",
      size: "md",
    },
  },
);

const pillColorVariants = cva([], {
  variants: {
    variant: {
      positive: "text-content-primary",
      warning: "text-content-primary",
      negative: "text-content-persistentWhite",
      bleedthrough: "text-content-primary",
      accent: "text-content-persistentWhite",
      accentPrimary: "text-content-persistentWhite",
      action: "text-content-primary",
      brand: "text-content-persistentWhite",
      transparent: "text-content-primary",
    },
    disabled: {
      true: "text-content-tertiary",
    },
  },
  defaultVariants: {
    variant: "positive",
  },
});

type InteractivePillProps = PressableProps & {
  onPress: () => void;
};

type NonInteractivePillProps = {
  onPress?: never;
};

export type PillProps = VariantProps<typeof pillVariants> & {
  label?: string;
  icon?: ReactNode;
  disabled?: boolean;
  iconPosition?: "left" | "right";
  textVariant?: TextProps["variant"];
} & (InteractivePillProps | NonInteractivePillProps);

export function Pill({
  label,
  variant,
  rounded,
  onPress,
  disabled,
  iconPosition = "left",
  icon,
  size,
  textVariant = "labelXXs/medium",
  ...rest
}: PillProps) {
  const content = (
    <View className="gap-5xs flex-row items-center">
      {iconPosition === "left" && icon}
      {label && (
        <Text
          variant={textVariant}
          className={pillColorVariants({ variant, disabled })}
        >
          {label}
        </Text>
      )}
      {iconPosition === "right" && icon}
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        className={pillVariants({ variant, rounded })}
        accessible
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        onPress={onPress}
        disabled={disabled}
        {...rest}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View className={pillVariants({ variant, rounded, size })}>{content}</View>
  );
}
