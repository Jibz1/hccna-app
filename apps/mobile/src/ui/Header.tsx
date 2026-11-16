import { Platform, View, ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cn } from "@/utils/styling";

type HeaderOptions = {
  presentation?: string;
};

export interface HeaderProps extends Omit<ViewProps, "style"> {
  backgroundColor?: "primary" | "accent-secondary";
  options?: HeaderOptions;
  containerClassName?: string;
}

export function Header({
  className,
  backgroundColor = "accent-secondary",
  options,
  containerClassName,
  ...props
}: HeaderProps) {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      className={cn(
        {
          "bg-background-accent-secondary":
            backgroundColor === "accent-secondary",
          "bg-background-primary": backgroundColor === "primary",
          "pt-safe": options?.presentation !== "modal",
        },
        containerClassName,
      )}
      style={Platform.select({
        native: {
          paddingLeft: safeAreaInsets.left,
          paddingRight: safeAreaInsets.right,
        },
      })}
    >
      <View
        pointerEvents="box-none"
        className={cn(
          "w-full max-w-256 flex-row items-center justify-between self-center px-2xs pt-2xs",
          className,
        )}
        {...props}
      />
    </View>
  );
}
