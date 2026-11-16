import { useRef, useState, type ReactNode } from "react";
import {
  type LayoutChangeEvent,
  type LayoutRectangle,
  useWindowDimensions,
  View,
} from "react-native";
import {
  type SharedValue,
  useAnimatedReaction,
  useSharedValue,
} from "react-native-reanimated";
import { Carousel } from "react-native-reanimated-carousel";
import { scheduleOnRN } from "react-native-worklets";

import { StraightPagination } from "@/components/layout/CarouselPagination";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { cn } from "@/utils/styling";

const AUTOPLAY_INTERVAL = 5000;
// Keep the active slide and its neighbors mounted.
const WINDOW_SIZE = 3;
type IndicatorVariant = "circular" | "straight";

const DEFAULT_ITEM_HEIGHT = 186;

export function SwipeableCarousel({
  items,
  className,
  indicatorVariant = "circular",
  loop = true,
  autoplay = true,
  hideDots = false,
  carouselProgress,
  setActiveIndex,
  height: heightProp,
  paginationFrame,
}: {
  items: ReactNode[];
  className?: string;
  indicatorVariant?: IndicatorVariant;
  loop?: boolean;
  autoplay?: boolean;
  hideDots?: boolean;
  carouselProgress?: SharedValue<number>;
  setActiveIndex: (index: number) => void;
  /** Optional explicit carousel height. When set, skips dynamic measurement
   * so dot position stays deterministic across devices. */
  height?: number;
  /** Image bounds used to keep pagination inset from its lower-right corner. */
  paginationFrame?: LayoutRectangle;
}) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const { width, onLayout } = useContainerWidth(windowWidth);
  const layoutKey = `${width}:${fontScale}`;
  const [measurement, setMeasurement] = useState({
    layoutKey,
    height: DEFAULT_ITEM_HEIGHT,
  });
  // Keep the last measured height until layout reports the new size. A font
  // scale change or Fast Refresh may leave the child's geometry unchanged,
  // so onLayout is not guaranteed to fire again.
  const height = heightProp ?? measurement.height;
  const [activeIndicatorIndex, setActiveIndicatorIndex] = useState(0);
  const activeIndicatorIndexRef = useRef(0);
  const localCarouselProgress = useSharedValue(0);
  const progress = carouselProgress ?? localCarouselProgress;
  const itemCount = items.length;
  const showPagination = !hideDots && indicatorVariant === "straight";

  const commitActiveIndex = (nextIndex: number) => {
    if (activeIndicatorIndexRef.current === nextIndex) {
      return;
    }

    activeIndicatorIndexRef.current = nextIndex;
    setActiveIndicatorIndex(nextIndex);
    setActiveIndex(nextIndex);
  };

  // Commit the active index as soon as progress crosses the transition
  // midpoint, instead of waiting for onSnapToItem (which fires only after
  // the snap animation settles), so the dots move with the fade.
  useAnimatedReaction(
    () =>
      itemCount > 0
        ? ((Math.round(progress.get()) % itemCount) + itemCount) % itemCount
        : 0,
    (nextIndex, previousIndex) => {
      if (nextIndex !== previousIndex) {
        scheduleOnRN(commitActiveIndex, nextIndex);
      }
    },
  );

  const handleLayout = (e: LayoutChangeEvent) => {
    if (heightProp !== undefined) {
      return;
    }
    const newHeight = e.nativeEvent.layout.height;
    // Neighbors can measure after the active slide. Keep room for the tallest
    // slide so a shorter description cannot clip a longer one or move the dots.
    setMeasurement((previous) => {
      if (
        previous.layoutKey === layoutKey &&
        newHeight <= previous.height + 0.5
      ) {
        return previous;
      }
      return { layoutKey, height: newHeight };
    });
  };

  const carouselStyle = { width, height, overflow: "hidden" as const };

  const renderItem = ({ index, item }: { index: number; item: ReactNode }) => (
    <View
      onLayout={handleLayout}
      key={index}
      className="gap-3xs flex flex-row items-center justify-center"
    >
      {item}
    </View>
  );

  return (
    <View
      onLayout={onLayout}
      className={cn("relative h-fit w-full gap-5xs", className)}
    >
      <Carousel
        loop={loop}
        itemSize={width}
        renderWindowSize={WINDOW_SIZE}
        style={carouselStyle}
        data={items}
        autoplay={autoplay}
        autoplayInterval={AUTOPLAY_INTERVAL}
        progress={progress}
        renderItem={renderItem}
      />
      {showPagination && (
        <View
          testID="carousel-pagination"
          pointerEvents="none"
          className={
            paginationFrame
              ? "p-4xs absolute items-end justify-end"
              : "right-xs absolute bottom-[60px] items-center justify-center"
          }
          style={
            paginationFrame
              ? {
                  left: paginationFrame.x,
                  top: paginationFrame.y,
                  width: paginationFrame.width,
                  height: paginationFrame.height,
                }
              : undefined
          }
        >
          <StraightPagination
            activeIndex={activeIndicatorIndex}
            count={itemCount}
            autoplay={autoplay}
            interval={AUTOPLAY_INTERVAL}
          />
        </View>
      )}
    </View>
  );
}
