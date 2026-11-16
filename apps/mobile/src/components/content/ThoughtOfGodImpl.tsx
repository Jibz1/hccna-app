import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { useWindowDimensions, View, Pressable } from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { DetailModalSection } from "@/components/layout/DetailModalLayout";
import { useRetryKey } from "@/components/providers/ErrorBoundaryWithRetry";
import {
  StyledImage as Image,
  StyledLegendList as LegendList,
} from "@/cssInterop";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/useAppTheme";
import { Link } from "@/ui/Link";
import { Text } from "@/ui/Text";
import { getIdFromUrl } from "@/utils/getIdFromUrl";

import { ThoughtOfGodImplQuery } from "./__generated__/ThoughtOfGodImplQuery.graphql";

type ThoughtOfGodYoutubeItem = NonNullable<
  NonNullable<ThoughtOfGodImplQuery["response"]["thoughtOfGod"]>["youtube"]
>[number];
type ThoughtOfGodBlogItem = NonNullable<
  NonNullable<ThoughtOfGodImplQuery["response"]["thoughtOfGod"]>["blogs"]
>[number];

const YOUTUBE_CARD_TEXT_HEIGHT = 132;
const BLOG_ROW_MIN_HEIGHT = 188;
const BLOG_SEPARATOR_HEIGHT = spacing["3xs"];

function YoutubeSeparator() {
  return <View className="w-3xs" />;
}

function BlogSeparator() {
  return <View className="h-3xs" />;
}

function SermonLink({
  item,
  itemWidth,
  itemHeight,
  cardHeight,
}: {
  item: ThoughtOfGodYoutubeItem;
  itemWidth: number;
  itemHeight: number;
  cardHeight: number;
}) {
  const { navigate } = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Watch ${item.title.trim()}`}
      onPress={() => {
        navigate({
          pathname: "/youtube-modal",
          params: {
            link: getIdFromUrl(item.youtubeLink),
            title: item.title,
            body: item.body,
            image: item.thumbnail ?? "",
          },
        });
      }}
      className="bg-design-surface-strong border-design-border overflow-hidden rounded-[26px] border active:opacity-80"
      style={{ width: itemWidth, height: cardHeight }}
    >
      <View style={{ height: itemHeight }}>
        <Image
          accessible={false}
          className="h-full w-full"
          cachePolicy="disk"
          contentFit="cover"
          source={item.thumbnail ?? ""}
        />
        <View
          pointerEvents="none"
          className="right-3xs bottom-3xs absolute h-[36px] w-[36px] items-center justify-center rounded-full bg-black/65"
        >
          <FontAwesome6 name="play" size={12} color="white" />
        </View>
      </View>
      <View className="gap-5xs p-3xs flex-1">
        <Text variant="labelSm/medium" color="designPrimary" numberOfLines={2}>
          {item.title.trim()}
        </Text>
        <Text variant="pXs/regular" color="designMuted" numberOfLines={2}>
          {item.body.trim()}
        </Text>
      </View>
    </Pressable>
  );
}

function ThoughtOfGodBlogCard({
  item,
  imageWidth,
  imageHeight,
}: {
  item: ThoughtOfGodBlogItem;
  imageWidth: number;
  imageHeight: number;
}) {
  const { colors } = useAppTheme();

  return (
    <Link
      href={item.link}
      accessibilityLabel={`Read ${item.title.trim()}`}
      className="gap-3xs p-3xs bg-design-surface-strong border-design-border w-full rounded-[26px] border active:opacity-80"
    >
      <Text variant="bodyLg/medium" color="designPrimary" numberOfLines={2}>
        {item.title.trim()}
      </Text>
      <View className="gap-3xs flex-row items-start">
        {item.thumbnail ? (
          <Image
            accessible={false}
            className="rounded-[14px]"
            cachePolicy="disk"
            contentFit="cover"
            source={item.thumbnail}
            style={{ width: imageWidth, height: imageHeight }}
          />
        ) : null}
        <Text
          variant="pXs/regular"
          color="designMuted"
          numberOfLines={4}
          className="min-w-0 flex-1"
        >
          {item.description.trim()}
        </Text>
      </View>
      <View className="gap-5xs flex-row items-center justify-between">
        <Text variant="labelXXs/medium" color="designAccent">
          Read article
        </Text>
        <FontAwesome6
          name="arrow-up-right-from-square"
          size={12}
          color={colors.accent}
        />
      </View>
    </Link>
  );
}

export function ThoughtOfGodSectionImpl() {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const { width, onLayout } = useContainerWidth(Math.min(windowWidth, 680));
  const contentWidth = Math.max(1, Math.min(width - spacing.xs * 2, 540));
  const carouselInset = Math.max(spacing.xs, (width - contentWidth) / 2);
  const imageWidth = Math.min(contentWidth * 0.3, 120);
  const imageHeight = imageWidth * (9 / 16);
  const youtubeItemWidth = Math.min(contentWidth * 0.85, 360);
  const youtubeItemHeight = youtubeItemWidth * (9 / 16);
  const youtubeListHeight =
    youtubeItemHeight + YOUTUBE_CARD_TEXT_HEIGHT * Math.max(1, fontScale);
  const blogRowHeight = Math.max(imageHeight + 132, BLOG_ROW_MIN_HEIGHT);
  const fetchKey = useRetryKey();
  const { thoughtOfGod } = useLazyLoadQuery<ThoughtOfGodImplQuery>(
    graphql`
      query ThoughtOfGodImplQuery {
        thoughtOfGod {
          description
          thumbnail
          title
          blogs {
            date
            description
            link
            thumbnail
            title
          }
          youtube {
            body
            thumbnail
            title
            youtubeLink
          }
        }
      }
    `,
    {},
    {
      fetchPolicy: "store-or-network",
      fetchKey,
    },
  );
  const youtubeItems = thoughtOfGod?.youtube ?? [];
  const blogItems = thoughtOfGod?.blogs ?? [];
  const blogListHeight =
    blogItems.length * blogRowHeight +
    Math.max(blogItems.length - 1, 0) * BLOG_SEPARATOR_HEIGHT;

  if (!thoughtOfGod) {
    return (
      <DetailModalSection>
        <Text color="designMuted" variant="pXs/regular">
          No reflections are available yet. Please check back soon.
        </Text>
      </DetailModalSection>
    );
  }

  return (
    <View onLayout={onLayout} className="gap-xs w-full">
      <DetailModalSection>
        <View className="gap-3xs">
          <Text
            accessibilityRole="header"
            variant="title/bold"
            color="designPrimary"
          >
            {thoughtOfGod.title}
          </Text>
          <Text variant="pXs/regular" color="designMuted">
            {thoughtOfGod.description}
          </Text>
        </View>
      </DetailModalSection>

      <View className="gap-3xs">
        <DetailModalSection>
          <Text
            accessibilityRole="header"
            variant="bodyLg/bold"
            color="designPrimary"
          >
            Latest videos
          </Text>
        </DetailModalSection>
        {youtubeItems.length > 0 ? (
          <LegendList<ThoughtOfGodYoutubeItem>
            recycleItems
            horizontal
            className="w-full"
            contentContainerStyle={{ paddingHorizontal: carouselInset }}
            showsHorizontalScrollIndicator={false}
            data={youtubeItems}
            estimatedItemSize={youtubeItemWidth}
            estimatedListSize={{
              height: youtubeListHeight,
              width,
            }}
            style={{ height: youtubeListHeight }}
            keyExtractor={(item, index) =>
              item.youtubeLink ?? `youtube-${index}`
            }
            ItemSeparatorComponent={YoutubeSeparator}
            renderItem={({ item }) => (
              <SermonLink
                item={item}
                itemWidth={youtubeItemWidth}
                itemHeight={youtubeItemHeight}
                cardHeight={youtubeListHeight}
              />
            )}
          />
        ) : (
          <DetailModalSection>
            <Text variant="pXs/regular" color="designMuted">
              New videos will appear here.
            </Text>
          </DetailModalSection>
        )}
      </View>

      <DetailModalSection>
        <View className="gap-3xs">
          <Text
            accessibilityRole="header"
            variant="bodyLg/bold"
            color="designPrimary"
          >
            Latest blogs
          </Text>
          {blogItems.length > 0 ? (
            <LegendList<ThoughtOfGodBlogItem>
              recycleItems
              data={blogItems}
              estimatedItemSize={blogRowHeight}
              estimatedListSize={{
                height: blogListHeight,
                width: contentWidth,
              }}
              scrollEnabled={false}
              className="w-full"
              keyExtractor={(item, index) => item.link ?? `blog-${index}`}
              ItemSeparatorComponent={BlogSeparator}
              renderItem={({ item }) => (
                <ThoughtOfGodBlogCard
                  item={item}
                  imageWidth={imageWidth}
                  imageHeight={imageHeight}
                />
              )}
            />
          ) : (
            <Text variant="pXs/regular" color="designMuted">
              New articles will appear here.
            </Text>
          )}
        </View>
      </DetailModalSection>
    </View>
  );
}
