import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { Suspense, useRef, useState } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import Animated, { useSharedValue } from "react-native-reanimated";

import { CommunitySections } from "@/components/home/CommunitySections";
import { FeaturedCarousel } from "@/components/home/FeaturedCarousel";
import { HomeBackground } from "@/components/home/HomeBackground";
import { HomeCampusBanner } from "@/components/home/HomeCampusBanner";
import { HomeSignInNudge } from "@/components/home/HomeSignInNudge";
import { AnimatedHeader } from "@/components/layout/AnimatedHeader";
import { BodyScrollView } from "@/components/layout/BodyScrollView";
import { screenSpacing } from "@/components/layout/tabScreenLayout";
import { useTabScreenLayout } from "@/components/layout/useTabScreenLayout";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import { connectivity } from "@/effect/connectivity";
import {
  type ConnectivityAwareFetchPolicy,
  useConnectivityAwareFetchPolicy,
} from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import {
  useHasCachedVerseOfTheDay,
  useVerseOfTheDay,
} from "@/hooks/relay/useVerseOfTheDay";
import { useDeferredMount } from "@/hooks/utils/useDeferredMount";
import type { FeaturedEventData } from "@/relay/featuredEvents";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

function VerseNotice({
  title,
  offline = false,
}: {
  title: string;
  offline?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View className="p-2xs gap-5xs bg-design-surface rounded-xl">
      <Text selectable variant="labelSm/medium" color="designPrimary">
        {title}
      </Text>
      {offline ? (
        <>
          <Text color="designMuted" variant="pXs/regular">
            Connect to the internet, then try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void connectivity.refresh().catch(() => undefined);
            }}
            className="gap-5xs min-h-11 flex-row items-center active:opacity-60"
          >
            <Text variant="labelXs/medium" color="designAccent">
              Try again
            </Text>
            <FontAwesome6 name="arrow-right" color={colors.accent} size={12} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function VerseHeroContent({
  fetchPolicy,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const { colors } = useAppTheme();
  const { navigate } = useRouter();
  const fetchKey = useRetryKey(fetchPolicy);
  const verse = useVerseOfTheDay({ fetchKey, fetchPolicy });

  if (!verse) {
    return <VerseNotice title="Today's verse will be available soon." />;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Verse of the Day, ${verse.book}. Read full verse.`}
      onPress={() => {
        navigate("/vod-detail-modal");
      }}
      className="gap-1.75 active:opacity-70"
    >
      <Text color="designMuted" variant="pXs/regular">
        Verse of the Day
      </Text>
      <Text
        selectable
        variant="headingSm/regular"
        className="font-scripture leading-[32px] tracking-[-0.5px]"
        color="designPrimary"
      >
        {verse.text}
      </Text>
      <View className="flex-row items-center gap-2.5">
        <Text selectable variant="labelSm/medium" color="designAccent">
          {verse.book}
        </Text>
        <FontAwesome6 name="arrow-right" size={17} color={colors.accent} />
      </View>
    </Pressable>
  );
}

function VerseHero() {
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedVerse = useHasCachedVerseOfTheDay();
  if (fetchPolicy === "store-only" && !hasCachedVerse) {
    return <VerseNotice title="Verse unavailable offline" offline />;
  }
  return (
    <ErrorBoundaryWithRetry
      title="Unable to load the verse"
      subtitle="Please try again later"
      fallbackClassName="w-full"
    >
      <Suspense fallback=<VerseNotice title="Loading today's verse…" />>
        <VerseHeroContent fetchPolicy={fetchPolicy} />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}

function HomeShortcuts({
  onCampusesPress,
  onLayout,
}: {
  onCampusesPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { colors } = useAppTheme();
  const { navigate } = useRouter();
  const shortcuts = [
    {
      title: "Visit",
      subtitle: "Find your campus",
      icon: "location-dot",
      onPress: onCampusesPress,
    },
    {
      title: "Watch",
      subtitle: "Watch a message",
      icon: "circle-play",
      onPress: () => {
        navigate("/sermons");
      },
    },
    {
      title: "Give",
      subtitle: "Give to your campus",
      icon: "heart",
      onPress: () => {
        navigate("/give");
      },
    },
  ] as const;
  return (
    <View
      onLayout={onLayout}
      className="mx-2xs border-continuous border-design-border bg-design-surface flex-row overflow-hidden rounded-xl border"
    >
      {shortcuts.map((shortcut, index) => (
        <Pressable
          key={shortcut.title}
          accessibilityRole="button"
          accessibilityLabel={`${shortcut.title}. ${shortcut.subtitle}`}
          onPress={shortcut.onPress}
          className="active:bg-design-selected min-h-19 min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-3"
        >
          {index > 0 ? (
            <View className="bg-design-border absolute top-5 bottom-5 left-0 w-px" />
          ) : null}
          <FontAwesome6 name={shortcut.icon} size={20} color={colors.accent} />
          <Text variant="labelXs/medium" color="designPrimary">
            {shortcut.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function HomeScreen({
  featuredEvents,
  onRefresh,
  refreshing = false,
}: {
  featuredEvents: readonly FeaturedEventData[];
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [campusBannerHeight, setCampusBannerHeight] = useState(0);
  const layout = useTabScreenLayout(0, campusBannerHeight);
  const [carouselLayout, setCarouselLayout] = useState<{
    y: number;
    height: number;
  } | null>(null);
  const [shortcutsBottom, setShortcutsBottom] = useState(0);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const campusesY = useRef(0);
  const shouldRenderBelowFoldSections = useDeferredMount();
  const scrollY = useSharedValue(0);
  const carouselProgress = useSharedValue(0);

  return (
    <View className="bg-design-background flex-1">
      <HomeBackground
        events={featuredEvents}
        carouselProgress={carouselProgress}
        glowBounds={
          carouselLayout && featuredEvents.length > 0
            ? {
                // The ScrollView's negative safe-area margin cancels the
                // matching top inset in its content padding.
                top: layout.contentTop + carouselLayout.y,
                height: Math.max(
                  carouselLayout.height,
                  shortcutsBottom - carouselLayout.y,
                ),
              }
            : null
        }
        scrollY={scrollY}
      />
      <AnimatedHeader scrollY={scrollY} layout={layout}>
        {(scrollProps) => (
          <BodyScrollView
            {...scrollProps}
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  // Below the floating campus card when it is shown.
                  progressViewOffset={
                    layout.contentTop - screenSpacing.headerGap
                  }
                />
              ) : undefined
            }
            ref={scrollRef}
            scrollEventThrottle={16}
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}
            contentContainerClassName="items-center"
          >
            <View className="gap-3xs w-full max-w-170">
              <HomeSignInNudge />
              <View className="px-xs pb-6xs pt-0.75">
                <VerseHero />
              </View>
              <FeaturedCarousel
                events={featuredEvents}
                scrollY={scrollY}
                carouselProgress={carouselProgress}
                onLayout={({ nativeEvent: { layout } }) => {
                  setCarouselLayout({ y: layout.y, height: layout.height });
                }}
              />
              <HomeShortcuts
                onLayout={({ nativeEvent: { layout } }) => {
                  setShortcutsBottom(layout.y + layout.height);
                }}
                onCampusesPress={() =>
                  scrollRef.current?.scrollTo({
                    y: campusesY.current + 16,
                    animated: true,
                  })
                }
              />
              <View
                onLayout={(event) => {
                  campusesY.current = event.nativeEvent.layout.y;
                }}
                className="pt-3xs"
              >
                {shouldRenderBelowFoldSections ? <CommunitySections /> : null}
              </View>
            </View>
          </BodyScrollView>
        )}
      </AnimatedHeader>
      {/* Collapses to zero height when hidden, moving content back up. */}
      <View
        pointerEvents="box-none"
        style={{ top: layout.topOverlayOffset }}
        onLayout={({ nativeEvent }) => {
          setCampusBannerHeight(nativeEvent.layout.height);
        }}
        className="px-xs absolute w-full max-w-170 self-center"
      >
        <HomeCampusBanner />
      </View>
    </View>
  );
}

export function HomeLoadingState() {
  const { colors } = useAppTheme();
  return (
    <View className="bg-design-background flex-1 items-center justify-center">
      <ActivityIndicator
        accessibilityLabel="Loading home"
        color={colors.accent}
      />
    </View>
  );
}
