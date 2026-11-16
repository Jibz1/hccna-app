import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { type SharedValue, useReducedMotion } from "react-native-reanimated";
import {
  type CarouselPanGesture,
  Carousel,
} from "react-native-reanimated-carousel";

import { StraightPagination } from "@/components/layout/CarouselPagination";
import {
  StyledImage as Image,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { useCarouselAutoplay } from "@/hooks/useCarouselAutoplay";
import SvgArrowRight from "@/icons/ArrowRight";
import type { FeaturedEventData } from "@/relay/featuredEvents";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { openInAppBrowser } from "@/utils/inAppBrowser";
import { statsig } from "@/utils/statsig";

const PAGE_INSET = 20; // Match the Featured / View all row's px-2xs.
const MIN_LAYOUT_WIDTH = PAGE_INSET * 2 + 8;
const DEFAULT_VIEWPORT_WIDTH = 393;
const AUTOPLAY_INTERVAL = 7000;
const FADE_DURATION = 550;
// Matches the platform tap tolerance (UIKit ~10pt, Android touch slop 8dp).
const TAP_SLOP = 10;
const IMAGE_OVERLAY = [
  "rgba(24, 15, 9, 0)",
  "rgba(24, 15, 9, 0.04)",
  "rgba(24, 15, 9, 0.35)",
  "rgba(24, 15, 9, 0.6)",
] as const;

function configurePanGesture(gesture: CarouselPanGesture) {
  // Leave vertical scrolling available while a finger starts on the image.
  gesture.activeOffsetX([-12, 12]).failOffsetY([-10, 10]);
  gesture.config.touchAction = "pan-y";
}

type TouchPoint = Pick<GestureResponderEvent["nativeEvent"], "pageX" | "pageY">;

// Pressable fires onPress for any release inside the card, however far the
// finger travelled. A swipe that fails the carousel pan (e.g. drifting past
// failOffsetY first) is never cancelled, so reject releases that moved like a
// swipe. Keyboard and assistive activations may lack coordinates; NaN keeps
// them treated as taps.
function movedBeyondTapSlop(start: TouchPoint | null, end: TouchPoint) {
  if (!start) {
    return false;
  }
  return (
    Math.hypot(end.pageX - start.pageX, end.pageY - start.pageY) > TAP_SLOP
  );
}

function selectionHaptic() {
  if (process.env.EXPO_OS !== "web") {
    Haptics.selectionAsync().catch(() => undefined);
  }
}

function eventKey(event: FeaturedEventData) {
  return `${event.slug ?? event.eventTitle}:${event.eventImageUrl}`;
}

function FeaturedSlides({
  events,
  width,
  autoplay,
  carouselProgress,
}: {
  events: readonly FeaturedEventData[];
  width: number;
  autoplay: boolean;
  carouselProgress?: SharedValue<number>;
}) {
  const { navigate } = useRouter();
  const {
    width: windowWidth,
    height: windowHeight,
    fontScale,
  } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const [controlFocused, setControlFocused] = useState(false);
  const pressStart = useRef<TouchPoint | null>(null);
  const multiple = events.length > 1;
  const cardWidth = width - PAGE_INSET * 2;
  // The short side keeps phones in landscape at their existing height.
  const maxCardHeight = Math.min(windowWidth, windowHeight) >= 600 ? 260 : 220;
  const cardHeight =
    Math.min(maxCardHeight, Math.max(216, cardWidth * 0.68)) +
    Math.max(0, fontScale - 1) * 110;
  const shouldAutoplay = multiple && autoplay && !controlFocused;
  const animateSlide = (progress: number) => {
    "worklet";
    // Keep the cards aligned while the current image dissolves into the next.
    // Swipe progress also drives the fade and the surrounding palette.
    return {
      opacity: Math.max(0, 1 - Math.abs(progress)),
      transform: [{ translateX: PAGE_INSET }],
    };
  };

  const openEvent = (event: FeaturedEventData) => {
    selectionHaptic();
    statsig.logEvent("featured_event_clicked", event.slug ?? event.eventTitle, {
      event_id: event.slug ?? event.eventTitle,
      event_title: event.eventTitle,
      event_description: event.description,
      event_image_url: event.eventImageUrl,
    });

    if (event.pageLink?.includes("news-and-events") && event.slug) {
      navigate({
        pathname: "/event-modal",
        params: {
          slug: event.slug.replace("/", ""),
          title: event.eventTitle,
        },
      });
    } else if (event.pageLink) {
      void openInAppBrowser(event.pageLink);
    }
  };

  return (
    <View className="overflow-hidden">
      <Carousel
        testID="design-v2-featured-carousel"
        data={[...events]}
        keyExtractor={eventKey}
        itemSize={cardWidth}
        itemAnimation={animateSlide}
        style={{ width, height: cardHeight }}
        loop={multiple}
        scrollEnabled={multiple}
        renderWindowSize={3}
        autoplay={shouldAutoplay}
        autoplayInterval={AUTOPLAY_INTERVAL}
        animation={{
          type: "timing",
          duration: reduceMotion ? 0 : FADE_DURATION,
        }}
        onConfigurePanGesture={configurePanGesture}
        onSnapToItem={setActiveIndex}
        progress={carouselProgress}
        renderItem={({ item: event, index }) => (
          <View
            pointerEvents={index === activeIndex ? "auto" : "none"}
            aria-hidden={index !== activeIndex}
            accessibilityElementsHidden={index !== activeIndex}
            importantForAccessibility={
              index === activeIndex ? "auto" : "no-hide-descendants"
            }
            style={{
              width: cardWidth,
              height: cardHeight,
            }}
            className="border-continuous bg-design-overlay overflow-hidden rounded-[20px]"
          >
            <Image
              source={event.eventImageUrl}
              contentFit="cover"
              cachePolicy="disk"
              enforceEarlyResizing
              recyclingKey={eventKey(event)}
              accessible={false}
              className="absolute inset-0"
            />
            <LinearGradient
              colors={IMAGE_OVERLAY}
              locations={[0, 0.32, 0.76, 1]}
              pointerEvents="none"
              className="absolute inset-0"
            />
            {event.pageLink ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${event.eventTitle}`}
                tabIndex={index === activeIndex ? 0 : -1}
                className="absolute inset-0 active:opacity-80"
                onFocus={() => {
                  setControlFocused(true);
                }}
                onBlur={() => {
                  setControlFocused(false);
                }}
                onPressIn={({ nativeEvent: { pageX, pageY } }) => {
                  pressStart.current = { pageX, pageY };
                }}
                onPress={({ nativeEvent }) => {
                  if (movedBeyondTapSlop(pressStart.current, nativeEvent)) {
                    return;
                  }
                  openEvent(event);
                }}
              />
            ) : null}

            <View
              pointerEvents="none"
              className="left-3xs right-3xs absolute bottom-[28px]"
            >
              <Text
                variant="featureTitle/medium"
                numberOfLines={2}
                className="leading-[22px] tracking-[-0.5px]"
                color="onImage"
              >
                {event.eventTitle}
              </Text>
            </View>
          </View>
        )}
      />
      {multiple ? (
        <View
          pointerEvents="none"
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            left: PAGE_INSET,
            width: cardWidth,
            height: cardHeight,
          }}
          className="px-2xs py-4xs absolute top-0 items-end justify-end"
        >
          <StraightPagination
            activeIndex={activeIndex}
            count={events.length}
            autoplay={shouldAutoplay}
            interval={AUTOPLAY_INTERVAL}
          />
        </View>
      ) : null}
    </View>
  );
}

export function FeaturedCarousel({
  events,
  scrollY,
  carouselProgress,
  onLayout: onSectionLayout,
}: {
  events: readonly FeaturedEventData[];
  scrollY?: SharedValue<number>;
  carouselProgress?: SharedValue<number>;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { colors } = useAppTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const { autoplay, onLayout } = useCarouselAutoplay(scrollY);

  if (events.length === 0) {
    return null;
  }

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    // Web navigation can hide the mounted home screen with a zero-width
    // layout. Keep its last visible dimensions until the screen returns.
    if (!Number.isFinite(width) || width <= MIN_LAYOUT_WIDTH) {
      return;
    }
    setMeasuredWidth(width);
    onLayout(event);
    onSectionLayout?.(event);
  };
  const fallbackWidth =
    viewportWidth > MIN_LAYOUT_WIDTH && Number.isFinite(viewportWidth)
      ? Math.min(viewportWidth, 680)
      : DEFAULT_VIEWPORT_WIDTH;

  return (
    <View
      onLayout={handleLayout}
      testID="design-v2-featured-section"
      className="gap-[6px]"
    >
      <View className="px-2xs flex-row items-center justify-between">
        <Text
          accessibilityRole="header"
          variant="headingXs/medium"
          className="leading-[24px] tracking-[-0.6px]"
          color="designPrimary"
        >
          Featured
        </Text>
        <Link href="/(tabs)/events" asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="View all events"
            className="min-h-[44px] flex-row items-center gap-[6px] active:opacity-60"
          >
            <Text
              className="leading-[20px]"
              color="designAccent"
              variant="body/regular"
            >
              View all
            </Text>
            <SvgArrowRight width={19} height={19} color={colors.accent} />
          </Pressable>
        </Link>
      </View>
      <FeaturedSlides
        key={events.map(eventKey).join("|")}
        events={events}
        width={measuredWidth ?? fallbackWidth}
        autoplay={autoplay}
        carouselProgress={carouselProgress}
      />
    </View>
  );
}
