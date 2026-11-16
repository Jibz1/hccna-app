import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Suspense, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, {
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { CampusesUnavailable } from "@/components/campuses/CampusesUnavailable";
import { GivingCard } from "@/components/giving/GivingCard";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import { useCampuses, useHasCachedCampuses } from "@/hooks/relay/useCampuses";
import {
  useConnectivityAwareFetchPolicy,
  type ConnectivityAwareFetchPolicy,
} from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import type { CampusData } from "@/relay/campuses";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

const campusGivingEntrance = FadeIn.duration(180).reduceMotion(
  ReduceMotion.System,
);

function CampusGivingChip({
  campus,
  active,
  onSelect,
}: {
  campus: CampusData;
  active: boolean;
  onSelect: (slug: string) => void;
}) {
  const selectionStyle = useAnimatedStyle(() => ({
    opacity: withTiming(active ? 1 : 0, {
      duration: 160,
      reduceMotion: ReduceMotion.System,
    }),
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Give at ${campus.campusName}`}
      accessibilityState={{ selected: active }}
      onPress={() => {
        if (!active) {
          onSelect(campus.slug);
        }
      }}
      className="border-continuous bg-design-surface border-design-border min-h-11 justify-center rounded-full border px-4 py-3 active:opacity-60"
    >
      <Text variant="caption/medium" color="designMuted">
        {campus.campusName}
      </Text>
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={selectionStyle}
        className="border-continuous bg-design-text absolute -inset-px items-center justify-center rounded-full"
      >
        <Text variant="caption/medium" color="designBackground">
          {campus.campusName}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export function CampusGivingOptions({
  campuses,
  preferredSlug,
  onCampusSelect,
}: {
  campuses: readonly CampusData[];
  preferredSlug: string;
  onCampusSelect: (slug: string) => void;
}) {
  const { colors } = useAppTheme();
  // Put the saved campus first on entry without moving chips after each tap.
  const [initialCampusSlug] = useState(preferredSlug);
  const availableCampuses = campuses.filter(
    (campus) =>
      campus.slug === initialCampusSlug ||
      campus.slug === preferredSlug ||
      (campus.givingPlatforms?.length ?? 0) > 0 ||
      Boolean(campus.giving),
  );
  const selected = availableCampuses.find(
    (campus) => campus.slug === preferredSlug,
  );

  if (!selected) {
    return (
      <Text color="designMuted" variant="body/regular">
        Giving options will be available soon.
      </Text>
    );
  }

  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <Text
          accessibilityRole="header"
          variant="title/bold"
          color="designPrimary"
        >
          Ways to give
        </Text>
        <Text variant="body/regular" color="designMuted">
          Choose your campus to get started.
        </Text>
      </View>
      {availableCampuses.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-5"
          contentContainerClassName="gap-2 px-5"
          contentInsetAdjustmentBehavior="never"
        >
          {availableCampuses.map((campus) => (
            <CampusGivingChip
              key={campus.slug}
              campus={campus}
              active={campus.slug === selected.slug}
              onSelect={onCampusSelect}
            />
          ))}
        </ScrollView>
      ) : null}
      <Animated.View
        key={selected.slug}
        entering={campusGivingEntrance}
        className="border-continuous bg-design-surface border-design-border gap-4 rounded-[28px] border p-4"
      >
        <View className="flex-row items-center gap-2 px-1 pt-1">
          <FontAwesome6 name="location-dot" size={13} color={colors.accent} />
          <Text variant="caption/medium" color="designMuted" className="flex-1">
            {selected.campusName}
            {selected.cityState ? ` · ${selected.cityState}` : ""}
          </Text>
        </View>
        <View className="gap-2.5">
          {selected.givingPlatforms?.length ? (
            selected.givingPlatforms.map((platform, index) => (
              <GivingCard
                key={`${selected.slug}:${platform.title}:${index}`}
                title={platform.title ?? "Website"}
                icon={platform.icon ?? ""}
                link={platform.link ?? selected.giving ?? ""}
                text={platform.link ? undefined : (platform.text ?? undefined)}
              />
            ))
          ) : selected.giving ? (
            <GivingCard title="Website" icon="" link={selected.giving ?? ""} />
          ) : (
            <Text
              variant="body/regular"
              color="designMuted"
              className="px-1 pb-1"
            >
              Giving options for this campus aren't available yet.
            </Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

function CampusGivingCardsImpl({
  orderingSlug,
  fetchPolicy,
}: {
  orderingSlug: string;
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const fetchKey = useRetryKey(fetchPolicy);
  const campuses = useCampuses({
    preferredCampus: orderingSlug,
    fetchKey,
    fetchPolicy,
  });
  const preferredCampus = usePreferredCampus();
  const [givingCampus, setGivingCampus] = useState<string>();
  const activeCampus = givingCampus ?? preferredCampus.slug;
  return (
    <CampusGivingOptions
      campuses={campuses}
      preferredSlug={activeCampus}
      onCampusSelect={setGivingCampus}
    />
  );
}

export function CampusGivingCards() {
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const preferredCampus = usePreferredCampus();
  const [orderingSlug] = useState(preferredCampus.slug);
  const hasCachedCampuses = useHasCachedCampuses(orderingSlug);
  if (fetchPolicy === "store-only" && !hasCachedCampuses) {
    return <CampusesUnavailable />;
  }

  return (
    <ErrorBoundaryWithRetry
      title="Unable to load campus giving"
      subtitle="Please try again later"
    >
      <Suspense fallback=<FullLoadingState />>
        <CampusGivingCardsImpl
          orderingSlug={orderingSlug}
          fetchPolicy={fetchPolicy}
        />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}
