import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { View } from "react-native";

import type { CampusData } from "@/relay/campuses";
import { useAppTheme } from "@/theme/useAppTheme";
import { Link } from "@/ui/Link";
import { Text } from "@/ui/Text";

function normalizeSocialUrl(value: string | null | undefined) {
  const href = value?.trim();
  if (!href) {
    return undefined;
  }

  // CMS links may omit the scheme, but the native URL opener requires it.
  return /^[a-z][a-z\d+.-]*:/i.test(href)
    ? href
    : `https://${href.replace(/^\/\//, "")}`;
}

export function CampusSocialLinks({
  facebook,
  instagram,
}: Pick<CampusData, "facebook" | "instagram">) {
  const { colors } = useAppTheme();
  const links = [
    {
      name: "Facebook",
      icon: "facebook" as const,
      href: normalizeSocialUrl(facebook),
    },
    {
      name: "Instagram",
      icon: "instagram" as const,
      href: normalizeSocialUrl(instagram),
    },
  ];

  if (!links.some((link) => link.href)) {
    return null;
  }

  return (
    <View className="gap-3xs p-3xs bg-design-surface-strong border-design-border rounded-[26px] border">
      <Text
        accessibilityRole="header"
        variant="bodyLg/bold"
        color="designPrimary"
      >
        Social media
      </Text>
      <View className="flex-row gap-3">
        {links.map(({ name, icon, href }) =>
          href ? (
            <Link
              key={name}
              href={href}
              openWithSystemBrowser
              accessibilityLabel={`Follow this campus on ${name}`}
              accessibilityHint={`Opens ${name}`}
              className="border-design-border bg-design-surface min-w-0 flex-1 rounded-[20px] border p-4 active:opacity-60"
            >
              <View className="flex-row items-center justify-between gap-2">
                <View className="bg-design-selected h-11 w-11 items-center justify-center rounded-[14px]">
                  <FontAwesome6
                    name={icon}
                    iconStyle="brands"
                    size={22}
                    color={colors.accent}
                  />
                </View>
                <FontAwesome6
                  name="arrow-up-right-from-square"
                  size={15}
                  color={colors.accent}
                />
              </View>
            </Link>
          ) : null,
        )}
      </View>
    </View>
  );
}
