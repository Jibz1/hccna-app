import * as Slot from "@rn-primitives/slot";
import { Linking, Platform, Pressable, PressableProps } from "react-native";

import { openInAppBrowser } from "@/utils/inAppBrowser";
import { cn } from "@/utils/styling";

export type BaseLinkProps = Omit<PressableProps, "hrefAttrs"> & {
  asChild?: boolean;
};

export type ExternalLinkProps = BaseLinkProps & {
  /** @platform web */
  href: string;

  /** @platform web */
  hrefAttrs?: {
    target?: string;
  };

  /** @platform native */
  openWithSystemBrowser?: boolean;
};

// Opens external URLs. Use `Link` from `expo-router` for in-app routes.
export type LinkProps = ExternalLinkProps & { underline?: boolean };

export function Link(props: LinkProps) {
  return (
    <ExternalLink
      className={cn(
        props.underline &&
          "underline underline-offset-[22%] decoration-[4%] decoration-content-primary",
        props.className,
      )}
      {...props}
    />
  );
}

function ExternalLink({
  href,
  openWithSystemBrowser = false,
  onPress,
  ...restProps
}: ExternalLinkProps) {
  const { onPress: platformSpecificOnPress, ...platformSpecificProps } =
    Platform.select<PressableProps | ExternalLinkProps>({
      web: {
        href,
        hrefAttrs: { target: "_blank" },
      },
      default: {
        onPress: (event) => {
          event?.preventDefault?.();

          if (openWithSystemBrowser) {
            void Linking.openURL(href);
          } else {
            void openInAppBrowser(href);
          }
        },
      },
    });

  return (
    <BaseLink
      onPress={(event) => {
        onPress?.(event);
        platformSpecificOnPress?.(event);
      }}
      {...restProps}
      {...platformSpecificProps}
    />
  );
}

function BaseLink({ asChild, ...props }: BaseLinkProps) {
  const Comp = asChild ? Slot.Pressable : Pressable;
  return <Comp role="link" {...props} />;
}
