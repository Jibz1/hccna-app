import { useRouter } from "expo-router";
import { use, useEffect, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  type CarouselPanGesture,
  Carousel,
} from "react-native-reanimated-carousel";

import { StraightPagination } from "@/components/layout/CarouselPagination";
import { ScrollOffsetContext } from "@/components/layout/ScrollOffsetContext";
import {
  StyledImage as Image,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { useCarouselAutoplay } from "@/hooks/useCarouselAutoplay";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

import { getSermonRoute, type SermonNavigationData } from "./sermon.utils";

export const HERO_SERMON_COUNT = 5;
const AUTOPLAY_INTERVAL = 7000;
const FADE_DURATION = 550;
// A slow push-in stands in for the preview video the CMS does not provide.
const ZOOM_SCALE = 1.08;
const ZOOM_DURATION = 12_000;

type HeroSermon = SermonNavigationData & { slug?: string | null };

function configurePanGesture(gesture: CarouselPanGesture) {
  // Leave vertical scrolling available while a finger starts on the artwork.
  gesture.activeOffsetX([-12, 12]).failOffsetY([-10, 10]);
  gesture.config.touchAction = "pan-y";
}

function sermonKey(sermon: HeroSermon, index: number) {
  return sermon.slug ?? sermon.youtubeLink ?? String(index);
}

function displayTitle(sermon: HeroSermon) {
  return sermon.title?.trim() ? sermon.title.trim() : "Sermon";
}

function HeroArtwork({
  thumbnail,
  zooming,
}: {
  thumbnail?: string | null;
  zooming: boolean;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!zooming) {
      cancelAnimation(scale);
      return;
    }
    scale.set(
      withRepeat(
        withTiming(ZOOM_SCALE, {
          duration: ZOOM_DURATION,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(scale);
    };
  }, [scale, zooming]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return (
    <Animated.View style={zoomStyle} className="absolute inset-0">
      {thumbnail ? (
        <Image
          source={thumbnail}
          accessible={false}
          contentFit="cover"
          contentPosition="center"
          cachePolicy="disk"
          enforceEarlyResizing
          recyclingKey={thumbnail}
          className="absolute inset-0"
        />
      ) : null}
    </Animated.View>
  );
}

function HeroSlides({
  featured,
  width,
  height,
  motionAllowed,
}: {
  featured: HeroSermon[];
  width: number;
  height: number;
  motionAllowed: boolean;
}) {
  const { navigate } = useRouter();
  const { colors } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const multiple = featured.length > 1;
  const active = featured[Math.min(activeIndex, featured.length - 1)];

  if (!active) {
    return null;
  }

  const autoplay = multiple && motionAllowed;
  const animateSlide = (progress: number) => {
    "worklet";
    // Keep the artwork in place while one sermon dissolves into the next.
    return {
      opacity: Math.max(0, 1 - Math.abs(progress)),
      transform: [{ translateX: 0 }],
    };
  };

  return (
    <>
      <Carousel
        testID="sermons-hero-carousel"
        data={featured}
        keyExtractor={sermonKey}
        itemSize={width}
        itemAnimation={animateSlide}
        style={{ width, height }}
        loop={multiple}
        scrollEnabled={multiple}
        renderWindowSize={3}
        autoplay={autoplay}
        autoplayInterval={AUTOPLAY_INTERVAL}
        animation={{
          type: "timing",
          duration: reduceMotion ? 0 : FADE_DURATION,
        }}
        onConfigurePanGesture={configurePanGesture}
        onSnapToItem={setActiveIndex}
        renderItem={({ item: sermon, index }) => {
          const isActive = index === activeIndex;
          const speaker = sermon.speakerFullName?.trim();
          return (
            <View
              pointerEvents="none"
              aria-hidden={!isActive}
              accessibilityElementsHidden={!isActive}
              importantForAccessibility={
                isActive ? "auto" : "no-hide-descendants"
              }
              style={{ width, height }}
              className="bg-design-selected overflow-hidden"
            >
              <HeroArtwork
                thumbnail={sermon.thumbnail}
                zooming={isActive && motionAllowed}
              />
              <LinearGradient
                // Keeps the theme's status bar and header legible over artwork.
                colors={[`${colors.background}b3`, `${colors.background}00`]}
                className="absolute top-0 right-0 left-0 h-40"
              />
              <LinearGradient
                colors={[
                  `${colors.background}00`,
                  `${colors.background}bf`,
                  colors.background,
                ]}
                locations={[0, 0.55, 1]}
                className="absolute right-0 bottom-0 left-0 h-[62%]"
              />
              <View className="absolute right-0 bottom-0 left-0 items-center gap-2 px-6">
                <Text
                  accessibilityRole="header"
                  variant="headingXl/bold"
                  color="designPrimary"
                  transform="uppercase"
                  centered
                  numberOfLines={3}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  // No fixed leading: iOS shrinks the font to fit but not a set line height.
                  className="tracking-[-1px]"
                >
                  {displayTitle(sermon)}
                </Text>
                {speaker ? (
                  <Text
                    variant="bodyLg/regular"
                    color="designMuted"
                    centered
                    numberOfLines={1}
                  >
                    {speaker}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Watch ${displayTitle(active)}`}
        onPress={() => {
          navigate(getSermonRoute(active));
        }}
        className="bg-design-text min-h-12 items-center justify-center rounded-full px-9 active:opacity-80"
      >
        <Text variant="bodyLg/medium" color="designBackground">
          Watch Now
        </Text>
      </Pressable>
      {multiple ? (
        <View
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <StraightPagination
            activeIndex={activeIndex}
            count={featured.length}
            autoplay={autoplay}
            interval={AUTOPLAY_INTERVAL}
            tone="onSurface"
          />
        </View>
      ) : null}
    </>
  );
}

/** Full-bleed artwork for the newest sermons, cross-fading between them. */
export function SermonsHero({ sermons }: { sermons: readonly HeroSermon[] }) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { width: measuredWidth, onLayout: onWidthLayout } = useContainerWidth();
  const { autoplay: motionAllowed, onLayout: onAutoplayLayout } =
    useCarouselAutoplay(use(ScrollOffsetContext) ?? undefined);
  const featured = sermons.slice(0, HERO_SERMON_COUNT);

  if (featured.length === 0) {
    return null;
  }

  const width = measuredWidth || windowWidth;
  // Tall enough to fill most of a phone, without towering over a wide window.
  const height = Math.round(
    Math.max(360, Math.min(windowHeight * 0.6, width * 1.35)),
  );

  return (
    <View
      onLayout={(event) => {
        onWidthLayout(event);
        onAutoplayLayout(event);
      }}
      className="w-full items-center gap-5"
    >
      <HeroSlides
        // On a data change the carousel keeps the visible slide by key without
        // reporting a snap. Restart both on the newest sermon so Watch Now
        // always opens the slide on screen.
        key={featured.map(sermonKey).join("|")}
        featured={featured}
        width={width}
        height={height}
        motionAllowed={motionAllowed}
      />
    </View>
  );
}
