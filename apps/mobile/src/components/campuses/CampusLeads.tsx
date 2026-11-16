import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useWindowDimensions, View } from "react-native";

import { leadTitle } from "@/components/campuses/leadTitle";
import { StyledImage as Image } from "@/cssInterop";
import type { CampusData } from "@/relay/campuses";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export function CampusLeads({ campusLeads }: Pick<CampusData, "campusLeads">) {
  const { colors } = useAppTheme();
  const { width, fontScale } = useWindowDimensions();
  const leads = campusLeads ?? [];

  if (leads.length === 0) {
    return null;
  }

  // Same single-column breakpoint as the Home campus grid.
  const stacked = leads.length === 1 || width < 360 || fontScale >= 1.5;
  const avatarClassName = cn("rounded-full", stacked ? "h-xl w-xl" : "h-l w-l");

  return (
    <View className="gap-3xs p-3xs bg-design-surface-strong border-design-border rounded-[26px] border">
      <Text
        accessibilityRole="header"
        variant="bodyLg/bold"
        color="designPrimary"
      >
        {leads.length === 1 ? "Campus lead" : "Campus leads"}
      </Text>
      <View className="gap-y-3xs flex-row flex-wrap justify-between">
        {leads.map((lead, index) => {
          const title = leadTitle(lead.leadershipGroup);
          return (
            <View
              key={`${lead.slug ?? lead.name}:${index}`}
              accessible
              className={cn(
                "border-continuous bg-design-surface flex-row items-center rounded-[20px]",
                stacked ? "gap-4xs p-4xs w-full" : "gap-5xs p-5xs w-[48%]",
              )}
            >
              <View className="border-design-accent rounded-full border-2 p-[3px]">
                {lead.image ? (
                  <Image
                    source={{ uri: lead.image }}
                    className={avatarClassName}
                    contentFit="cover"
                    contentPosition="top"
                    cachePolicy="disk"
                  />
                ) : (
                  <View
                    className={cn(
                      "bg-design-selected items-center justify-center",
                      avatarClassName,
                    )}
                  >
                    <FontAwesome6 name="user" size={20} color={colors.accent} />
                  </View>
                )}
              </View>
              <View className="gap-6xs min-w-0 flex-1">
                <Text
                  variant={stacked ? "body/medium" : "caption/medium"}
                  color="designPrimary"
                >
                  {lead.name}
                </Text>
                {title ? (
                  <Text
                    variant="labelXXs/medium"
                    color="designMuted"
                    numberOfLines={2}
                  >
                    {title}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
