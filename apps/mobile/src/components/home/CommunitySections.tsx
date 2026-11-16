import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { type ReactNode, Suspense } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import {
  type GraphQLTaggedNode,
  graphql,
  useLazyLoadQuery,
  useRelayEnvironment,
} from "react-relay";
import { createOperationDescriptor, getRequest } from "relay-runtime";

import { leadCycleOrders } from "@/components/design-v2/campusLeads";
import { CampusLocationCard } from "@/components/design-v2/CampusLocationCard";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import { getSermonRoute } from "@/components/sermons/sermon.utils";
import { StyledImage as Image } from "@/cssInterop";
import { connectivity } from "@/effect/connectivity";
import { useCampuses, useHasCachedCampuses } from "@/hooks/relay/useCampuses";
import {
  type ConnectivityAwareFetchPolicy,
  useConnectivityAwareFetchPolicy,
} from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import { useCampusLeadPlayback } from "@/hooks/useCampusLeadCycle";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

import type { LatestSermonsQuery } from "./__generated__/LatestSermonsQuery.graphql";
import type { ThoughtOfGodQuery } from "./__generated__/ThoughtOfGodQuery.graphql";

const ThoughtOfGodQueryDocument = graphql`
  query ThoughtOfGodQuery {
    thoughtOfGod {
      description
      thumbnail
      title
    }
  }
`;

const LatestSermonsQueryDocument = graphql`
  query LatestSermonsQuery {
    sermons(first: 3) {
      edges {
        node {
          slug
          title
          thumbnail
          speakerFullName
          speakerImage
          youtubeLink
        }
      }
    }
  }
`;

function SectionNotice({
  title,
  offline = false,
}: {
  title: string;
  offline?: boolean;
}) {
  return (
    <View className="mx-2xs p-2xs gap-5xs bg-design-surface rounded-xl">
      <Text selectable variant="labelXs/medium" color="designPrimary">
        {title}
      </Text>
      {offline ? (
        <>
          <Text color="designMuted" variant="caption/regular">
            Connect to the internet to load this content.
          </Text>
          <Pressable
            accessibilityRole="button"
            className="min-h-[44px] justify-center self-start active:opacity-60"
            onPress={() => {
              void connectivity.refresh().catch(() => undefined);
            }}
          >
            <Text variant="labelXs/medium" color="designAccent">
              Try again
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function SectionBoundary({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <ErrorBoundaryWithRetry
      title={`Unable to load ${title.toLowerCase()}`}
      subtitle="Please try again later"
      fallbackClassName="mx-[20px]"
    >
      <Suspense
        fallback=<SectionNotice title={`Loading ${title.toLowerCase()}…`} />
      >
        {children}
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}

// Reuse the retained app queries, including their cached records, without a
// second data source or a design-only fixture.
function useHasCachedQuery(query: GraphQLTaggedNode) {
  const environment = useRelayEnvironment();
  const operation = createOperationDescriptor(getRequest(query), {});
  return environment.check(operation).status === "available";
}

function CampusGrid({
  fetchPolicy,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const { colors } = useAppTheme();
  const { width, fontScale } = useWindowDimensions();
  const isSingleColumn = width < 360 || fontScale >= 1.5;
  const fetchKey = useRetryKey(fetchPolicy);
  const campuses = useCampuses({ fetchKey, fetchPolicy });
  // Relay shares campus records across queries, including their isPreferred flags.
  // Use the saved preference so another query cannot change the active card.
  const { slug: preferredSlug, campusName } = usePreferredCampus();
  const leadPlayback = useCampusLeadPlayback();
  const cycleOrders = leadCycleOrders(campuses);

  if (campuses.length === 0) {
    return <SectionNotice title="Campus locations will be available soon." />;
  }

  return (
    <View className="px-2xs gap-4">
      <View className="gap-1.5">
        <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Text
            accessibilityRole="header"
            variant="titleLg/bold"
            color="designPrimary"
            className="tracking-[-0.5px]"
          >
            Locations
          </Text>
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={`My campus: ${campusName}`}
            className="bg-design-selected max-w-full flex-row items-center gap-2 rounded-full px-3 py-1.5"
          >
            <FontAwesome6 name="location-dot" size={12} color={colors.accent} />
            <Text
              variant="caption/medium"
              color="designAccent"
              className="shrink"
            >
              {campusName}
            </Text>
          </View>
        </View>
        <Text variant="body/regular" color="designMuted">
          Find your church community.
        </Text>
      </View>
      <View className="flex-row flex-wrap items-stretch justify-between gap-y-3">
        {campuses.map((campus) => (
          <CampusLocationCard
            key={campus.slug}
            campus={campus}
            isPreferred={campus.slug === preferredSlug}
            isSingleColumn={isSingleColumn}
            leadPlayback={leadPlayback}
            staggerOrder={cycleOrders.get(campus.slug) ?? 0}
          />
        ))}
      </View>
    </View>
  );
}

function CampusesSection() {
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedCampuses = useHasCachedCampuses();
  if (fetchPolicy === "store-only" && !hasCachedCampuses) {
    return (
      <SectionNotice title="Campus information unavailable offline" offline />
    );
  }
  return (
    <SectionBoundary title="Campus locations">
      <CampusGrid fetchPolicy={fetchPolicy} />
    </SectionBoundary>
  );
}

function ThoughtCard({
  fetchPolicy,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const { colors } = useAppTheme();
  const { navigate } = useRouter();
  const fetchKey = useRetryKey(fetchPolicy);
  const { thoughtOfGod } = useLazyLoadQuery<ThoughtOfGodQuery>(
    ThoughtOfGodQueryDocument,
    {},
    { fetchKey, fetchPolicy },
  );
  if (!thoughtOfGod) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Read ${thoughtOfGod.title || "Thought of God"}`}
      onPress={() => {
        navigate("/thought-of-god");
      }}
      className="mx-2xs border-design-border gap-5 border-y py-6 active:opacity-70"
    >
      <View className="flex-row items-center gap-2">
        <FontAwesome6 name="book-open" size={14} color={colors.accent} />
        <Text
          variant="captionSm/medium"
          color="designAccent"
          className="tracking-[1.8px] uppercase"
        >
          Thought of God
        </Text>
      </View>
      <View className="flex-row items-start gap-4">
        <View className="min-w-0 flex-1 gap-3">
          <Text
            accessibilityRole="header"
            variant="headingSm/regular"
            className="font-scripture leading-[31px] tracking-[-0.5px]"
            numberOfLines={3}
            color="designPrimary"
          >
            {thoughtOfGod.title || "A moment to reflect."}
          </Text>
          <Text
            numberOfLines={3}
            className="leading-[22px]"
            color="designMuted"
            variant="body/regular"
          >
            {thoughtOfGod.description}
          </Text>
        </View>
        {thoughtOfGod.thumbnail ? (
          <Image
            source={thoughtOfGod.thumbnail}
            accessibilityLabel={thoughtOfGod.title}
            contentFit="cover"
            cachePolicy="disk"
            enforceEarlyResizing
            className="border-continuous bg-design-selected h-28 w-20 rounded-lg"
          />
        ) : null}
      </View>
      <View className="flex-row items-center gap-2">
        <Text variant="labelXs/medium" color="designAccent">
          Read devotional
        </Text>
        <FontAwesome6 name="arrow-right" size={13} color={colors.accent} />
      </View>
    </Pressable>
  );
}

function ThoughtSection() {
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedThought = useHasCachedQuery(ThoughtOfGodQueryDocument);
  if (fetchPolicy === "store-only" && !hasCachedThought) {
    return <SectionNotice title="Thought of God unavailable offline" offline />;
  }
  return (
    <SectionBoundary title="Thought of God">
      <ThoughtCard fetchPolicy={fetchPolicy} />
    </SectionBoundary>
  );
}

function SermonCards({
  fetchPolicy,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const { colors } = useAppTheme();
  const { navigate } = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.5;
  const fetchKey = useRetryKey(fetchPolicy);
  const { sermons } = useLazyLoadQuery<LatestSermonsQuery>(
    LatestSermonsQueryDocument,
    {},
    { fetchKey, fetchPolicy },
  );
  const items =
    sermons?.edges?.flatMap((edge) => (edge.node ? [edge.node] : [])) ?? [];
  if (items.length === 0) {
    return null;
  }

  return (
    <View className="px-2xs gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text
          accessibilityRole="header"
          variant="titleLg/bold"
          color="designPrimary"
          className="min-w-0 flex-1 tracking-[-0.5px]"
        >
          Latest sermons
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all latest sermons"
          onPress={() => {
            navigate("/sermons");
          }}
          className="min-h-11 flex-row items-center gap-1.5 active:opacity-60"
        >
          <Text variant="labelXs/medium" color="designAccent">
            View all
          </Text>
          <FontAwesome6 name="arrow-right" size={12} color={colors.accent} />
        </Pressable>
      </View>
      {/* LatestSermonsQuery requests just three cards; no long list is mounted. */}
      <View className="gap-3">
        {items.map((sermon) => (
          <Pressable
            key={
              sermon.slug ??
              sermon.youtubeLink ??
              `${sermon.title}:${sermon.thumbnail}`
            }
            accessibilityRole="button"
            accessibilityLabel={`Watch ${sermon.title ?? "sermon"}${sermon.speakerFullName ? ` by ${sermon.speakerFullName}` : ""}`}
            className={`border-continuous bg-design-surface gap-3 rounded-[24px] p-3 active:opacity-70 ${stacked ? "" : "flex-row items-stretch"}`}
            onPress={() => {
              navigate(getSermonRoute(sermon));
            }}
          >
            <View
              className={`border-continuous bg-design-selected overflow-hidden rounded-[14px] ${stacked ? "aspect-video w-full" : "min-h-[72px] w-28 shrink-0"}`}
            >
              {sermon.thumbnail ? (
                <Image
                  source={sermon.thumbnail}
                  contentFit="cover"
                  cachePolicy="disk"
                  enforceEarlyResizing
                  accessible={false}
                  className="absolute inset-0"
                />
              ) : (
                <View className="flex-1 items-center justify-center">
                  <FontAwesome6 name="video" size={24} color={colors.accent} />
                </View>
              )}
              <View
                accessible={false}
                className="bg-design-overlay absolute right-1.5 bottom-1.5 h-6 w-6 items-center justify-center rounded-full"
              >
                <FontAwesome6 name="play" size={9} color={colors.onImage} />
              </View>
            </View>
            <View
              className={`justify-center gap-2 py-1 ${stacked ? "" : "min-w-0 flex-1"}`}
            >
              <Text
                variant="labelSm/medium"
                numberOfLines={stacked ? undefined : 3}
                color="designPrimary"
                className="leading-[21px] tracking-[-0.3px]"
              >
                {sermon.title?.trim() ? sermon.title : "Sermon"}
              </Text>
              {sermon.speakerFullName ? (
                <View className="flex-row items-center gap-1.5">
                  {sermon.speakerImage ? (
                    <Image
                      source={sermon.speakerImage}
                      contentFit="cover"
                      contentPosition="top"
                      cachePolicy="disk"
                      enforceEarlyResizing
                      accessible={false}
                      className="bg-design-selected h-5 w-5 shrink-0 rounded-full"
                    />
                  ) : null}
                  <Text
                    color="designMuted"
                    variant="captionSm/regular"
                    className="min-w-0 flex-1"
                  >
                    {sermon.speakerFullName}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SermonsSection() {
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedSermons = useHasCachedQuery(LatestSermonsQueryDocument);
  if (fetchPolicy === "store-only" && !hasCachedSermons) {
    return <SectionNotice title="Latest sermons unavailable offline" offline />;
  }
  return (
    <SectionBoundary title="Latest sermons">
      <SermonCards fetchPolicy={fetchPolicy} />
    </SectionBoundary>
  );
}

export function CommunitySections() {
  return (
    <View className="gap-8">
      <CampusesSection />
      <ThoughtSection />
      <SermonsSection />
    </View>
  );
}
