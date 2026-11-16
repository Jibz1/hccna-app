import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import type { LegendListRef } from "@legendapp/list/react-native";
import { type ReactNode, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { graphql, usePaginationFragment } from "react-relay";

import type { AnimatedHeaderScrollProps } from "@/components/layout/AnimatedHeader";
import {
  StyledAnimatedScrollView,
  StyledAnimatedLegendList as LegendList,
} from "@/cssInterop";
import { useScrollToTop } from "@/hooks/navigation/useTabToTop";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

import type {
  SermonsItemsFragment$data,
  SermonsItemsFragment$key,
} from "./__generated__/SermonsItemsFragment.graphql";
import { SermonRow } from "./SermonRow";
import { SermonsHero } from "./SermonsHero";

type SermonListItem = NonNullable<
  NonNullable<
    NonNullable<SermonsItemsFragment$data["sermons"]>["edges"]
  >[number]["node"]
>;

const ITEM_COUNT = 10;

function SermonItemSeparator() {
  // Inset to the text column, past the 64pt thumbnail and its gap.
  return (
    <View className="w-full max-w-170 self-center px-5">
      <View className="bg-design-border my-3 ml-[76px] h-px" />
    </View>
  );
}

function SermonsListHeader() {
  const { colors } = useAppTheme();
  return (
    <View className="w-full flex-row items-center justify-between gap-4 px-5 pb-6">
      <View className="flex-1 gap-1">
        <Text
          accessibilityRole="header"
          variant="headingLg/bold"
          color="designPrimary"
          className="tracking-[-1.2px]"
        >
          Sermons
        </Text>
        <Text variant="body/regular" color="designMuted">
          Watch and revisit recent messages.
        </Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="border-continuous border-design-border bg-design-surface h-14 w-14 items-center justify-center rounded-[20px] border"
      >
        <FontAwesome6 name="book-bible" size={23} color={colors.accent} />
      </View>
    </View>
  );
}

export function SermonsListState({
  children,
  scrollProps,
}: {
  children: ReactNode;
  scrollProps: AnimatedHeaderScrollProps;
}) {
  const { isDark } = useAppTheme();
  const listRef = useRef(null);
  useScrollToTop(listRef);
  return (
    <StyledAnimatedScrollView
      ref={listRef}
      className="w-full max-w-256 flex-1 self-center"
      contentContainerClassName="w-full"
      contentContainerStyle={scrollProps.contentContainerStyle}
      style={scrollProps.style}
      onScroll={scrollProps.onScroll}
      scrollEventThrottle={16}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator
      indicatorStyle={isDark ? "white" : "black"}
    >
      <SermonsListHeader />
      <View className="w-full max-w-170 self-center px-5">{children}</View>
    </StyledAnimatedScrollView>
  );
}

function renderSermon({ item }: { item: SermonListItem }) {
  return (
    <SermonRow
      title={item.title}
      thumbnail={item.thumbnail}
      speakerFullName={item.speakerFullName}
      speakerImage={item.speakerImage}
      youtubeLink={item.youtubeLink}
    />
  );
}

const SermonsItemsFragment = graphql`
  fragment SermonsItemsFragment on Query
  @argumentDefinitions(
    cursor: { type: "String" }
    count: { type: "Int", defaultValue: 10 }
  )
  @refetchable(queryName: "SermonsItemsRefetchQuery") {
    sermons(first: $count, after: $cursor)
      @connection(key: "SermonsItems_sermons") {
      edges {
        node {
          slug
          title
          thumbnail
          speakerFullName
          speakerImage
          youtubeLink
          pageName
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export function SermonsItems({
  rootQuery,
  scrollProps,
  topInset,
}: {
  rootQuery: SermonsItemsFragment$key;
  scrollProps: AnimatedHeaderScrollProps;
  topInset: number;
}) {
  const { colors, isDark } = useAppTheme();
  const { width, onLayout } = useContainerWidth();
  const { fontScale } = useWindowDimensions();
  const numColumns = width >= 768 && fontScale < 1.5 ? 2 : 1;
  const listRef = useRef<LegendListRef>(null);
  const [paginationError, setPaginationError] = useState(false);
  useScrollToTop(listRef);
  const { data, loadNext, hasNext, isLoadingNext } = usePaginationFragment(
    SermonsItemsFragment,
    rootQuery,
  );
  const sermonsList =
    data.sermons?.edges?.flatMap((edge) => (edge.node ? [edge.node] : [])) ??
    [];
  const loadMore = () => {
    if (!hasNext || isLoadingNext) {
      return;
    }
    setPaginationError(false);
    loadNext(ITEM_COUNT, {
      onComplete: (error) => {
        setPaginationError(error != null);
      },
    });
  };

  if (sermonsList.length === 0 && !hasNext) {
    return (
      <SermonsListState scrollProps={scrollProps}>
        <View className="border-continuous border-design-border bg-design-surface items-center gap-3 rounded-[26px] border px-6 py-10">
          <FontAwesome6 name="book-bible" size={28} color={colors.accent} />
          <Text variant="title/medium" color="designPrimary" centered>
            Messages are on the way
          </Text>
          <Text variant="body/regular" color="designMuted" centered>
            Check back soon for the latest sermons.
          </Text>
        </View>
      </SermonsListState>
    );
  }

  return (
    <LegendList<SermonListItem>
      ref={listRef}
      recycleItems
      onLayout={onLayout}
      numColumns={numColumns}
      data={sermonsList}
      className="w-full max-w-256 flex-1 self-center"
      contentContainerClassName="w-full"
      // The hero runs up under the status bar and the floating header.
      contentContainerStyle={[
        scrollProps.contentContainerStyle,
        { paddingTop: topInset },
      ]}
      style={scrollProps.style}
      onScroll={scrollProps.onScroll}
      scrollEventThrottle={16}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator
      indicatorStyle={isDark ? "white" : "black"}
      estimatedItemSize={88}
      keyExtractor={(item, index) =>
        item.slug ?? item.youtubeLink ?? item.pageName ?? String(index)
      }
      ItemSeparatorComponent={SermonItemSeparator}
      ListHeaderComponent={
        <View className="w-full pb-4">
          <SermonsHero sermons={sermonsList} />
          <View className="w-full max-w-170 self-center px-5 pt-9">
            <Text
              accessibilityRole="header"
              variant="bodyLg/medium"
              color="designMuted"
            >
              All Sermons
            </Text>
          </View>
        </View>
      }
      ListFooterComponent={
        <View className="w-full max-w-170 items-center gap-3 self-center px-5 pt-6">
          {isLoadingNext ? (
            <ActivityIndicator
              accessibilityLabel="Loading more sermons"
              color={colors.accent}
            />
          ) : paginationError || sermonsList.length === 0 ? (
            <>
              {paginationError ? (
                <Text
                  accessibilityRole="alert"
                  variant="body/regular"
                  color="designMuted"
                  centered
                >
                  Couldn't load more sermons. Please try again.
                </Text>
              ) : null}
              <Pressable
                onPress={loadMore}
                accessibilityRole="button"
                className="border-design-border bg-design-surface active:bg-design-selected min-h-12 items-center justify-center rounded-full border px-6 py-3"
              >
                <Text variant="body/medium" color="designPrimary">
                  {paginationError ? "Try again" : "Load more sermons"}
                </Text>
              </Pressable>
            </>
          ) : !hasNext ? (
            <Text variant="caption/regular" color="designMuted">
              You're all caught up
            </Text>
          ) : null}
        </View>
      }
      onEndReachedThreshold={0.3}
      onEndReached={() => {
        if (!paginationError) {
          loadMore();
        }
      }}
      renderItem={renderSermon}
    />
  );
}
