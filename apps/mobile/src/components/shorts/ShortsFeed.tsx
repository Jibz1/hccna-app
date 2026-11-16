import type { LegendListRef } from "@legendapp/list/react-native";
import { useIsFocused } from "expo-router";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { FeedbackCard } from "@/components/design-v2/FeedbackCard";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import { StyledLegendList as LegendList } from "@/cssInterop";
import { connectivity } from "@/effect/connectivity";
import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { useIsAppActive } from "@/hooks/useIsAppActive";
import SvgWifiOff from "@/icons/WifiOff";
import { useAppTheme } from "@/theme/useAppTheme";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Text } from "@/ui/Text";

import type { ShortsFeedQuery } from "./__generated__/ShortsFeedQuery.graphql";
import { ShortPage } from "./ShortPage";
import { appendCycle, type FeedEntry } from "./shortsOrder";

const ShortsQuery = graphql`
  query ShortsFeedQuery {
    shorts {
      id
      videoId
      title
      channelTitle
      thumbnail
      curated
    }
  }
`;

type Short = ShortsFeedQuery["response"]["shorts"][number];
type Entry = FeedEntry<Short>;

/** Enough pages ahead that there is always a next one to swipe to. */
const MIN_ENTRIES = 3;
/** Add the next pass when this few pages remain. */
const APPEND_WITHIN = 2;
/** How far, in points, a resting list may sit from a page's top. */
const AT_REST_TOLERANCE = 1;

/**
 * Whole shuffled passes laid end to end. The pass count is kept rather than
 * derived from the lengths: a refetch can change how many shorts there are,
 * and a derived count would then repeat page keys.
 */
type Feed = { readonly entries: readonly Entry[]; readonly passes: number };

function addPass(feed: Feed, shorts: readonly Short[]): Feed {
  if (shorts.length === 0) {
    return feed;
  }
  return {
    entries: appendCycle(feed.entries, shorts, feed.passes),
    passes: feed.passes + 1,
  };
}

function firstPasses(shorts: readonly Short[]): Feed {
  let feed: Feed = { entries: [], passes: 0 };
  while (shorts.length > 0 && feed.entries.length < MIN_ENTRIES) {
    feed = addPass(feed, shorts);
  }
  return feed;
}

/** Space the header, the switch and the tab bar cover at the screen's edges. */
type EdgeCover = { readonly top: number; readonly bottom: number };

/** Centers a message in the part of the screen nothing else covers. */
function FeedState({
  cover,
  className,
  children,
}: {
  cover: EdgeCover;
  className: string;
  children: ReactNode;
}) {
  return (
    <View
      testID="shorts-feed-state"
      style={{ paddingTop: cover.top, paddingBottom: cover.bottom }}
      className={className}
    >
      {children}
    </View>
  );
}

function ShortsPager({
  shorts,
  overlayTop,
  overlayBottom,
  onShown,
}: {
  shorts: readonly Short[];
  overlayTop: number;
  overlayBottom: number;
  /** Called once the pager is on screen. */
  onShown: () => void;
}) {
  const isFocused = useIsFocused();
  const appIsActive = useIsAppActive();
  // Shuffled once per mount: the Sermons screen unmounts the feed when the
  // switch leaves Shorts, so every return to Shorts gets a new order, while
  // coming back from another tab keeps the place.
  const [feed, setFeed] = useState(() => firstPasses(shorts));
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState<{ width: number; height: number }>();
  // Keep the listener's sound preference when they swipe to another short.
  const [muted, setMuted] = useState(false);
  const canPlay = isFocused && appIsActive;
  const listRef = useRef<LegendListRef>(null);
  // Read when the screen changes size, which must not re-run on every swipe.
  const activeIndexRef = useRef(0);
  const sizedFor = useRef<number>(undefined);
  const pageHeight = page?.height;

  useEffect(() => {
    onShown();
  }, [onShown]);

  // A rotation or a split-view resize changes every page's height, leaving
  // the old scroll position between two pages. Go back to the playing one.
  useEffect(() => {
    if (!pageHeight) {
      return;
    }
    if (sizedFor.current !== undefined && sizedFor.current !== pageHeight) {
      void listRef.current?.scrollToIndex({
        index: activeIndexRef.current,
        animated: false,
      });
    }
    sizedFor.current = pageHeight;
  }, [pageHeight]);

  const settleOn = (index: number) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
    setFeed((current) =>
      index >= current.entries.length - APPEND_WITHIN
        ? addPass(current, shorts)
        : current,
    );
  };

  return (
    <View
      testID="shorts-pager-frame"
      onLayout={({ nativeEvent: { layout } }) => {
        setPage({ width: layout.width, height: layout.height });
      }}
      className="flex-1"
    >
      {page && page.height > 0 ? (
        <LegendList<Entry>
          ref={listRef}
          data={feed.entries}
          // Items re-render only when this changes.
          extraData={{ activeIndex, canPlay, muted }}
          // A page owns a live player; never hand its component to another short.
          recycleItems={false}
          keyExtractor={(entry) => entry.key}
          renderItem={({ item, index }) => (
            <ShortPage
              short={item.short}
              width={page.width}
              height={page.height}
              overlayTop={overlayTop}
              overlayBottom={overlayBottom}
              isActive={index === activeIndex}
              canPlay={canPlay}
              muted={muted}
              onToggleMute={() => {
                setMuted((current) => !current);
              }}
            />
          )}
          getFixedItemSize={() => page.height}
          estimatedItemSize={page.height}
          drawDistance={page.height}
          pagingEnabled
          snapToInterval={page.height}
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          onMomentumScrollEnd={({ nativeEvent }) => {
            settleOn(Math.round(nativeEvent.contentOffset.y / page.height));
          }}
          // A slow drag released exactly on a page starts no momentum, so no
          // momentum end follows. Anywhere else the snap is still to come.
          onScrollEndDrag={({ nativeEvent }) => {
            const offset = nativeEvent.contentOffset.y;
            const index = Math.round(offset / page.height);
            if (Math.abs(offset - index * page.height) <= AT_REST_TOLERANCE) {
              settleOn(index);
            }
          }}
        />
      ) : null}
    </View>
  );
}

function LoadedShorts({
  fetchPolicy,
  cover,
  onShown,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
  cover: EdgeCover;
  onShown: () => void;
}) {
  const fetchKey = useRetryKey(fetchPolicy);
  const { shorts } = useLazyLoadQuery<ShortsFeedQuery>(
    ShortsQuery,
    {},
    { fetchKey, fetchPolicy },
  );

  if (shorts.length === 0) {
    return (
      <FeedState
        cover={cover}
        className="flex-1 items-center justify-center px-6"
      >
        <Text
          variant="body/regular"
          color="white"
          centered
          className="opacity-70"
        >
          No shorts yet. Check back soon.
        </Text>
      </FeedState>
    );
  }
  return (
    <ShortsPager
      shorts={shorts}
      overlayTop={cover.top}
      overlayBottom={cover.bottom}
      onShown={onShown}
    />
  );
}

export function ShortsFeed({
  topPadding,
  bottomPadding,
  fetchPolicy,
}: {
  /** What the header and the switch cover at the top of the screen. */
  topPadding: number;
  /** What the tab bar covers at the bottom of the screen. */
  bottomPadding: number;
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const { colors } = useAppTheme();
  const cover: EdgeCover = { top: topPadding, bottom: bottomPadding };
  const [feedShown, setFeedShown] = useState(false);
  const markFeedShown = useCallback(() => {
    setFeedShown(true);
  }, []);

  // A cached list is no use offline: every short streams from YouTube. A feed
  // already on screen stays, though: a dropped connection is often brief, and
  // replacing the feed would lose the place and reshuffle on the way back. A
  // short that cannot load meanwhile offers its own retry.
  if (fetchPolicy === "store-only" && !feedShown) {
    return (
      <FeedState cover={cover} className="flex-1 justify-center px-5">
        <FeedbackCard
          title="Shorts unavailable offline"
          message="Connect to the internet, then try again."
          icon=<SvgWifiOff width={24} height={24} color={colors.accent} />
          onAction={() => {
            void connectivity.refresh().catch(() => undefined);
          }}
        />
      </FeedState>
    );
  }

  return (
    // Full screen: the video runs under the header, the switch and the tab
    // bar. Loading, empty and error states sit on the same dark surface.
    <View testID="shorts-feed-surface" className="flex-1 bg-black">
      <ErrorBoundaryWithRetry
        title="Unable to load shorts"
        subtitle="Please check your connection and try again."
        fallbackClassName="border-design-border bg-design-surface mx-5 rounded-[26px] border"
        fallbackRender={(fallback) => (
          <FeedState cover={cover} className="flex-1 justify-center">
            {fallback}
          </FeedState>
        )}
      >
        <Suspense
          fallback={
            <FeedState
              cover={cover}
              className="flex-1 items-center justify-center"
            >
              <LoadingIndicator />
            </FeedState>
          }
        >
          <LoadedShorts
            fetchPolicy={fetchPolicy}
            cover={cover}
            onShown={markFeedShown}
          />
        </Suspense>
      </ErrorBoundaryWithRetry>
    </View>
  );
}
