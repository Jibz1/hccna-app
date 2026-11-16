import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { useAppTheme } from "@/theme/useAppTheme";
import { Link } from "@/ui/Link";
import { Text } from "@/ui/Text";

export function MoreSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-3">
      <Text
        accessibilityRole="header"
        variant="title/medium"
        color="designPrimary"
        className="px-1"
      >
        {title}
      </Text>
      <View className="border-continuous border-design-border bg-design-surface overflow-hidden rounded-[26px] border">
        {children}
      </View>
    </View>
  );
}

export function MoreRow({
  title,
  subtitle,
  icon,
  last = false,
  expanded,
  ...action
}: {
  title: string;
  subtitle?: string;
  icon: string;
  last?: boolean;
  expanded?: boolean;
} & (
  | { href: string; onPress?: never }
  | { onPress: () => void; href?: never }
  | { href?: never; onPress?: never }
)) {
  const { colors } = useAppTheme();
  const content = (
    <>
      <View className="bg-design-selected h-10 w-10 items-center justify-center rounded-[14px]">
        <FontAwesome6
          name={
            FontAwesome6.hasIcon(icon, "solid") ||
            FontAwesome6.hasIcon(icon, "regular") ||
            FontAwesome6.hasIcon(icon, "brand")
              ? icon
              : "link"
          }
          size={17}
          color={colors.accent}
        />
      </View>
      <View className="flex-1 gap-1 py-1">
        <Text variant="body/medium" color="designPrimary">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption/regular" color="designMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action.href !== undefined || action.onPress !== undefined ? (
        <FontAwesome6
          name={
            action.href
              ? "arrow-up-right-from-square"
              : expanded
                ? "chevron-down"
                : "chevron-right"
          }
          size={12}
          color={colors.textMuted}
        />
      ) : null}
    </>
  );
  const className =
    "active:bg-design-selected min-h-[80px] flex-row items-center gap-3.5 px-[18px] py-3";

  return (
    <View>
      {action.href !== undefined ? (
        <Link href={action.href} className={className}>
          {content}
        </Link>
      ) : action.onPress !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={expanded === undefined ? undefined : { expanded }}
          onPress={action.onPress}
          className={className}
        >
          {content}
        </Pressable>
      ) : (
        <View className={className}>{content}</View>
      )}
      {!last ? (
        <View className="bg-design-border mr-[18px] ml-[72px] h-px" />
      ) : null}
    </View>
  );
}
