import { cva, VariantProps } from "class-variance-authority";
import { Predicate } from "effect";
import { ReactNode } from "react";
import { View } from "react-native";

import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

const cardHeaderFooterStyles = cva("bg-background-secondary py-4xs", {
  variants: {
    align: {
      center: "items-center",
      left: "items-start",
    },
    type: {
      header: null,
      footer: null,
    },
    rounded: {
      xl: null,
      lg: null,
      m: null,
      s: null,
      none: null,
    },
  },
  compoundVariants: [
    {
      type: "header",
      rounded: "lg",
      className: "rounded-t-lg",
    },
    {
      type: "header",
      rounded: "m",
      className: "rounded-t-m",
    },
    {
      type: "header",
      rounded: "s",
      className: "rounded-t-s",
    },
    {
      type: "footer",
      rounded: "lg",
      className: "rounded-b-lg",
    },
    {
      type: "footer",
      rounded: "m",
      className: "rounded-b-m",
    },
    {
      type: "footer",
      rounded: "s",
      className: "rounded-b-s",
    },
  ],
  defaultVariants: {
    align: "center",
    rounded: "lg",
  },
});

const cardStyles = cva("w-full border-none overflow-hidden", {
  variants: {
    variant: {
      surface: "bg-background-surface border-transparent",
      surfaceMuted: "bg-background-surface-muted border-transparent",
      primary: "bg-background-primary border-transparent",
      secondary: "bg-background-victoria border-transparent",
      accentSecondary: "border-transparent bg-background-shearwater/30", // TODO: bg style?
      accentPrimary: "border-transparent bg-background-shearwater", // TODO: bg style?
      inverseBleedthroughWeak:
        "bg-background-inverse-bleedthrough-weak border-transparent",
      persistentWhite: "bg-background-persistentWhite border-transparent",
      grayBleedthroughWeak: "bg-background-neutral/8 border-transparent",
      transparent: "bg-transparent border-transparent",
      bgTintOverlay: "bg-background-victoria border-transparent",
      shearwater: "bg-background-shearwater border-transparent",
    },
    withPadding: {
      true: "p-3xs",
    },
    rounded: {
      xl: "rounded-xl",
      lg: "rounded-lg",
      m: "rounded-m",
      s: "rounded-sm",
      none: "rounded-none",
    },
    shadow: {
      true: "shadow-regular",
      false: "",
    },
    border: {
      true: "border border-border-weak",
      false: "",
    },
    grow: {
      true: "grow",
      false: "",
    },
  },
  defaultVariants: {
    variant: "primary",
    rounded: "lg",
    grow: false,
    shadow: false,
  },
});

type CardHeaderFooterStylesProps = VariantProps<typeof cardHeaderFooterStyles>;
type CardStylesProps = VariantProps<typeof cardStyles>;

interface CardHeaderFooterProps extends CardHeaderFooterStylesProps {
  content: string | ReactNode;
}

function CardHeaderFooter({
  content,
  align,
  type,
  rounded,
}: CardHeaderFooterProps) {
  return (
    <View
      className={cardHeaderFooterStyles({
        align,
        type,
        rounded,
      })}
    >
      {Predicate.isString(content) ? (
        <Text variant="p/regular" color="secondary">
          {content}
        </Text>
      ) : (
        content
      )}
    </View>
  );
}

interface CardProps extends CardStylesProps {
  children: ReactNode;
  header?: string | ReactNode;
  footer?: string | ReactNode;
  headerAlign?: CardHeaderFooterProps["align"];
  footerAlign?: CardHeaderFooterProps["align"];
  className?: string;
}

export function Card({
  variant,
  header,
  footer,
  rounded,
  grow,
  headerAlign,
  footerAlign,
  children,
  withPadding,
  className,
}: CardProps) {
  return (
    <View
      // Merge, so a className override replaces the variant's conflicting class: Uniwind
      // resolves conflicts by stylesheet order, not by their order in className.
      className={cn(
        cardStyles({ variant, rounded, grow, withPadding }),
        className,
      )}
    >
      {Predicate.isString(header) ? (
        <CardHeaderFooter
          rounded={rounded}
          content={header}
          align={headerAlign}
          type="header"
        />
      ) : (
        header
      )}
      {children}
      {Predicate.isString(footer) ? (
        <CardHeaderFooter
          rounded={rounded}
          content={footer}
          align={footerAlign}
          type="footer"
        />
      ) : (
        footer
      )}
    </View>
  );
}
