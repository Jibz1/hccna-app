import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { View } from "react-native";
import Animated, {
  FadeInUp,
  FadeOutUp,
  ReduceMotion,
} from "react-native-reanimated";

import { CampusCard } from "@/components/design-v2/CampusCard";
import { campusLeadsOf } from "@/components/design-v2/campusLeads";
import { LiveStreamIndicator } from "@/components/live/LiveStreamIndicator";
import { StyledImage as Image } from "@/cssInterop";
import { useCampusLiveStatus } from "@/hooks/events/useCampusLiveStatus";
import {
  type CampusLeadPlayback,
  useCampusLeadIndex,
} from "@/hooks/useCampusLeadCycle";
import type { CampusData } from "@/relay/campuses";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

const leadNameEntering = FadeInUp.duration(280).reduceMotion(
  ReduceMotion.System,
);
const leadNameExiting = FadeOutUp.duration(280).reduceMotion(
  ReduceMotion.System,
);

/** One lead's name at a time, sliding up to the next; long names end in an ellipsis. */
function CyclingLeadName({ name, index }: { name: string; index: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="h-[15px] overflow-hidden"
    >
      <Animated.View
        key={index}
        entering={leadNameEntering}
        exiting={leadNameExiting}
        className="absolute inset-x-0 top-0"
      >
        <Text
          variant="captionSm/medium"
          color="designPrimary"
          numberOfLines={1}
          className="leading-[15px]"
        >
          {name}
        </Text>
      </Animated.View>
    </View>
  );
}

export function CampusLocationCard({
  campus,
  isPreferred,
  isSingleColumn,
  leadPlayback,
  staggerOrder,
}: {
  campus: CampusData;
  isPreferred: boolean;
  isSingleColumn: boolean;
  /** From useCampusLeadPlayback, shared by every card in the grid. */
  leadPlayback: CampusLeadPlayback;
  /** The card's place among the cards that cycle (leadCycleOrders); later cards change later. */
  staggerOrder: number;
}) {
  const { colors } = useAppTheme();
  const { navigate } = useRouter();
  const liveStatus = useCampusLiveStatus(campus.slug);
  const campusLeads = campusLeadsOf(campus);
  const visibleLeads = campusLeads.slice(0, 3);
  const remainingLeadCount = campusLeads.length - visibleLeads.length;
  const campusLeadLabel =
    campusLeads.length > 1 ? "Campus leads" : "Campus lead";
  const namedLeads = campusLeads.filter((lead) => lead.name);
  const campusLeadNames = namedLeads.map((lead) => lead.name).join(" & ");
  const cyclesLeads = leadPlayback !== "still" && namedLeads.length > 1;
  const leadIndex = useCampusLeadIndex(
    cyclesLeads ? namedLeads.length : 1,
    staggerOrder,
    leadPlayback === "playing",
  );
  const shownLead = cyclesLeads ? namedLeads[leadIndex] : undefined;
  const leadsLabel = namedLeads.length > 1 ? "Leads" : "Lead";

  return (
    <CampusCard
      isPreferred={isPreferred}
      isSingleColumn={isSingleColumn}
      accessibilityRole="button"
      accessibilityLabel={`${campus.campusName}.${campus.location ? ` Location: ${campus.location}.` : ""} ${liveStatus === null ? "Streaming status unavailable" : liveStatus === true ? "Streaming live" : "Not streaming live"}`}
      accessibilityHint={`${isPreferred ? "Your preferred campus. " : ""}${campusLeadNames ? `${campusLeadLabel}, ${campusLeadNames}. ` : ""}Opens campus details.`}
      onPress={() => {
        navigate({
          pathname: "/campus-modal",
          params: { slug: campus.slug },
        });
      }}
    >
      <View className="shrink-0 gap-1.5">
        <View className="flex-row items-start gap-2">
          <Text
            variant="headingXs/medium"
            color="designPrimary"
            numberOfLines={2}
            className="min-w-0 flex-1 leading-[23px] tracking-[-0.5px]"
          >
            {campus.campusName}
          </Text>
          <View
            accessible={false}
            className="h-[23px] justify-center"
            style={{ opacity: liveStatus === true ? 1 : 0.45 }}
          >
            <LiveStreamIndicator
              isLive={liveStatus === true}
              size={8}
              inactiveColor={colors.textMuted}
            />
          </View>
        </View>
        {liveStatus === true ? (
          <Text variant="captionSm/medium" color="designAccent">
            Live now
          </Text>
        ) : null}
        {campus.location ? (
          <Text
            variant="caption/regular"
            color="designMuted"
            numberOfLines={3}
            className="leading-[18px]"
          >
            {campus.location}
          </Text>
        ) : null}
      </View>
      <View accessible={false} className="shrink-0 flex-row items-center gap-1">
        <View className="relative shrink-0 flex-row items-center">
          {(visibleLeads.length > 0 ? visibleLeads : [null]).map(
            (lead, index) => (
              <View
                key={`${lead?.name ?? "campus"}:${index}`}
                className={cn(
                  "bg-design-surface-strong h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-2",
                  isPreferred
                    ? "dark:border-design-selected border-white"
                    : "border-design-surface",
                  lead !== null &&
                    lead === shownLead &&
                    "border-design-accent dark:border-design-accent z-10",
                  index > 0 && "-ml-5",
                )}
              >
                {lead?.image ? (
                  <Image
                    source={lead.image}
                    contentFit="cover"
                    contentPosition="top"
                    cachePolicy="disk"
                    enforceEarlyResizing
                    accessible={false}
                    className="h-full w-full"
                  />
                ) : (
                  <FontAwesome6
                    name={lead ? "user" : "location-dot"}
                    size={12}
                    color={colors.accent}
                  />
                )}
              </View>
            ),
          )}
          {remainingLeadCount > 0 ? (
            <View
              className={cn(
                "bg-design-selected -ml-5 h-7 min-w-7 items-center justify-center rounded-full border-2 px-1",
                isPreferred
                  ? "dark:border-design-selected border-white"
                  : "border-design-surface",
              )}
            >
              <Text variant="captionSm/medium" color="designAccent">
                +{remainingLeadCount}
              </Text>
            </View>
          ) : null}
          {isPreferred ? (
            <View className="bg-design-surface-strong absolute -right-0.5 -bottom-0.5 z-20 h-3 w-3 items-center justify-center rounded-full">
              <FontAwesome6 name="check" size={6} color={colors.accent} />
            </View>
          ) : null}
        </View>
        <View className="min-w-0 flex-1">
          {namedLeads.length > 0 ? (
            <Text
              variant="captionSm/regular"
              color="designMuted"
              className="leading-[15px]"
            >
              {leadsLabel}
            </Text>
          ) : null}
          {shownLead?.name ? (
            <CyclingLeadName name={shownLead.name} index={leadIndex} />
          ) : campusLeadNames ? (
            <Text
              variant="captionSm/medium"
              color="designPrimary"
              numberOfLines={namedLeads.length > 1 ? 2 : 1}
              className="leading-[15px]"
            >
              {campusLeadNames}
            </Text>
          ) : null}
        </View>
        <FontAwesome6 name="arrow-right" size={10} color={colors.accent} />
      </View>
    </CampusCard>
  );
}
