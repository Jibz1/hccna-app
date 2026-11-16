import { ReactNode } from "react";

import { Pill, PillProps } from "@/ui/Pill";

type ChipsCtaProps = {
  title?: string;
  accessibilityLabel?: string;
  icon?: ReactNode;
  onPress: () => void;
  variant?: PillProps["variant"];
  iconPosition?: PillProps["iconPosition"];
};

export function ChipsCta({
  onPress,
  title,
  accessibilityLabel,
  icon,
  variant = "bleedthrough",
  iconPosition = "left",
}: ChipsCtaProps) {
  return (
    <Pill
      label={title}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      variant={variant}
      icon={icon}
      iconPosition={iconPosition}
    />
  );
}
