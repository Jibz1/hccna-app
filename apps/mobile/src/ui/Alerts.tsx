import { cva, VariantProps } from "class-variance-authority";
import { ElementRef, ElementType, type Ref } from "react";
import { Pressable, View, type ViewProps } from "react-native";

import SvgInfo from "@/icons/Info";
import SvgWarningTriangular from "@/icons/WarningTriangular";
import SvgX12 from "@/icons/X12";
import { Text, TextProps } from "@/ui/Text";

const alertVariants = cva("flex-row gap-3 p-4 items-center w-full border", {
  variants: {
    variant: {
      positive: "bg-design-surface-strong border-design-border",
      warning: "bg-design-surface-strong border-design-accent/30",
      negative: "bg-design-surface-strong border-design-negative/30",
      neutral: "bg-design-surface-strong border-design-border",
      notification: "bg-design-surface-strong border-design-border",
    },
    rounded: {
      lg: "rounded-lg",
      xl: "rounded-xl",
    },
  },
  defaultVariants: {
    variant: "positive",
    rounded: "lg",
  },
});

const iconContainerVariants = cva(
  "size-9 shrink-0 rounded-[12px] justify-center items-center",
  {
    variants: {
      variant: {
        positive: "bg-design-selected",
        warning: "bg-design-selected",
        negative: "bg-design-negative/10",
        neutral: "bg-design-selected",
        notification: "bg-design-selected",
      },
    },
    defaultVariants: { variant: "positive" },
  },
);

const iconMap = {
  positive: SvgInfo,
  warning: SvgInfo,
  negative: SvgWarningTriangular,
  neutral: SvgInfo,
  notification: SvgInfo,
};

function Alert({
  variant,
  rounded,
  children,
  onClose,
  customIcon,
  ref,
  ...props
}: ViewProps &
  VariantProps<typeof alertVariants> & {
    onClose?: () => void;
    customIcon?: ElementType;
    ref?: Ref<ElementRef<typeof View>>;
  }) {
  const Icon = customIcon ?? iconMap[variant ?? "positive"];

  return (
    <View
      ref={ref}
      role="alert"
      className={alertVariants({ variant, rounded })}
      {...props}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={iconContainerVariants({ variant })}
      >
        <Icon
          className={
            variant === "negative"
              ? "text-design-negative"
              : "text-design-accent"
          }
          width={16}
          height={16}
        />
      </View>
      <View className="min-w-0 flex-1 flex-col gap-1">{children}</View>

      {onClose && (
        <Pressable
          role="button"
          accessibilityLabel="Dismiss notification"
          onPress={() => {
            onClose?.();
          }}
          className="size-11 items-center justify-center rounded-full active:opacity-60"
        >
          <SvgX12
            className="size-4xs text-design-text-muted"
            width={16}
            height={16}
          />
        </Pressable>
      )}
    </View>
  );
}

function AlertHeadline({
  ref,
  ...props
}: Omit<TextProps, "variant"> & { ref?: Ref<ElementRef<typeof Text>> }) {
  return (
    <Text ref={ref} variant="body/medium" color="designPrimary" {...props} />
  );
}

function AlertMessage({
  ref,
  ...props
}: Omit<TextProps, "variant"> & { ref?: Ref<ElementRef<typeof Text>> }) {
  return (
    <Text ref={ref} variant="caption/regular" color="designMuted" {...props} />
  );
}

export { Alert, AlertHeadline, AlertMessage };
