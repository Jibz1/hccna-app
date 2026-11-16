import { cva, VariantProps } from "class-variance-authority";
import type { ComponentRef, Ref } from "react";
import {
  Text as ReactNativeText,
  TextProps as ReactNativeTextProps,
} from "react-native";

import { SizeAndWeightVariant, parseVariant } from "@/ui/utils";
import { cn } from "@/utils/styling";

const textStyles = cva("break-keep", {
  variants: {
    size: {
      // Headings
      headingXl: "text-heading-xl",
      headingLg: "text-heading-lg",
      heading: "text-heading",
      headingSm: "text-heading-sm",
      headingXs: "text-heading-xs",

      // Labels
      labelXl: "text-label-xl",
      labelLg: "text-label-lg",
      label: "text-label",
      labelSm: "text-label-sm",
      labelXs: "text-label-xs",
      labelXXs: "text-label-xxs",
      labelXXxs: "text-label-xxxs",

      // Paragraphs
      pXl: "text-p-xl",
      pLg: "text-p-lg",
      p: "text-p",
      pSm: "text-p-sm",
      pXs: "text-p-xs",

      // Compact copy and titles used by the home and account screens.
      captionSm: "text-caption-sm",
      caption: "text-caption",
      body: "text-body",
      bodyLg: "text-body-lg",
      title: "text-title",
      featureTitle: "text-feature-title",
      titleLg: "text-title-lg",
      screenTitle: "text-screen-title",
      scripture: "text-scripture",
    },
    weight: {
      regular: "font-sans",
      medium: "font-sans-medium",
      bold: "font-sans-bold",
    },
    color: {
      primary: "text-content-primary",
      secondary: "text-content-secondary",
      tertiary: "text-content-tertiary",
      persistentWhite: "text-content-persistentWhite",
      persistentWhite64: "text-content-persistentWhite-op64",
      persistentBlack: "text-content-persistentBlack",
      persistentBlack64: "text-content-persistentBlack-op64",
      negative: "text-content-negative",
      warning: "text-content-warning",
      positive: "text-content-positive",
      inverse: "text-content-inverse",
      callout: "text-[#feecc9]",
      black: "text-[#000000]",
      white: "text-[#ffffff]",
      designPrimary: "text-design-text",
      designMuted: "text-design-text-muted",
      designAccent: "text-design-accent",
      designBackground: "text-design-background",
      designNegative: "text-design-negative",
      onImage: "text-design-on-image",
      verseText: "text-verse-text",
      verseReference: "text-verse-reference",
      verseLabel: "text-verse-label",
      verseAction: "text-verse-action",
      verseFeedback: "text-verse-feedback",
      verseMuted: "text-verse-muted",
    },
    transform: {
      uppercase: "uppercase",
      capitalize: "capitalize",
      lowercase: "lowercase",
    },
    centered: {
      true: "text-center",
    },
    truncate: {
      true: "truncate",
    },
    underline: {
      // Line height needs adjustment on Android or underlines don't render (Android-specific)
      true: "underline underline-offset-[22%] decoration-[4%] android:leading-[1.3]",
    },
  },
  defaultVariants: {
    color: "primary",
  },
});

type TextStylesProps = VariantProps<typeof textStyles>;

type TextProps = {
  variant?: SizeAndWeightVariant<TextStylesProps>;
} & ReactNativeTextProps &
  Omit<TextStylesProps, "size" | "weight">;

function Text({
  variant = "p/regular",
  className,
  color,
  centered,
  transform,
  truncate,
  underline,
  ref,
  ...props
}: TextProps & { ref?: Ref<ComponentRef<typeof ReactNativeText>> }) {
  const [size, weight] = parseVariant<TextStylesProps>(variant);
  return (
    <ReactNativeText
      className={cn(
        textStyles({
          size,
          weight,
          color,
          transform,
          centered,
          truncate,
          underline,
          className,
        }),
      )}
      numberOfLines={truncate ? 1 : undefined}
      ref={ref}
      {...props}
    />
  );
}

export { Text, TextProps };
