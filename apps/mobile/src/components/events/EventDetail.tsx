import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { format, isValid, parseISO } from "date-fns";
import { format as formatTZ } from "date-fns-tz";
import { Option, Schema } from "effect";
import { Redirect } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { graphql, useLazyLoadQuery } from "react-relay";

import { RichDocument, RichText } from "@/components/content/RichText";
import { useRetryKey } from "@/components/providers/ErrorBoundaryWithRetry";
import { StyledAnimatedScrollView, StyledImage as Image } from "@/cssInterop";
import { useConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { useScrollHeaderTitle } from "@/hooks/useScrollHeaderTitle";
import { useAppTheme } from "@/theme/useAppTheme";
import { Link } from "@/ui/Link";
import { Text } from "@/ui/Text";

import { EventDetailQuery } from "./__generated__/EventDetailQuery.graphql";
import { EventEmptyState, EventLayout } from "./EventLayout";
import { eventSessionTimes } from "./eventSessionTimes";

const speakerContentStyle = {
  gap: 12,
  paddingHorizontal: 20,
  paddingBottom: 8,
};

const EventDetailQ = graphql`
  query EventDetailQuery($slug: String!, $campusSlug: String!) {
    events(slug: $slug, campusSlug: $campusSlug) {
      description
      eventDate
      eventImageUrl
      eventTime
      eventTitle
      pageTitle
      reoccurring
      slug
      eventMonth
      pageName
      content
      sessions {
        id
        startsAt
        label
      }

      zoomLink
      eventSpeakers {
        fullName
        image
      }
      room
    }
  }
`;

function eventText(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  return text;
}

function EventFact({
  icon,
  label,
  children,
}: {
  icon: ComponentProps<typeof FontAwesome6>["name"];
  label: string;
  children: ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View className="flex-row items-start gap-3.5">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="bg-design-selected h-11 w-11 items-center justify-center rounded-2xl"
      >
        <FontAwesome6 name={icon} size={17} color={colors.accent} />
      </View>
      <View className="min-w-0 flex-1 gap-1 py-0.5">
        <Text variant="caption/regular" color="designMuted">
          {label}
        </Text>
        <Text selectable variant="bodyLg/medium" color="designPrimary">
          {children}
        </Text>
      </View>
    </View>
  );
}

export function EventDetail({
  slug,
  campusSlug,
  campusName,
  fallbackTitle = "Event",
}: {
  slug: string;
  campusSlug: string;
  campusName: string;
  fallbackTitle?: string;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  // Wait for a fresh response before treating an empty result as a missing event.
  const fetchPolicy =
    useConnectivityAwareFetchPolicy() === "store-only"
      ? "store-only"
      : "network-only";
  const { showHeaderTitle, onScroll, onTitleLayout } = useScrollHeaderTitle();
  const fetchKey = useRetryKey(fetchPolicy);
  const { events } = useLazyLoadQuery<EventDetailQuery>(
    EventDetailQ,
    { slug, campusSlug },
    { fetchPolicy, fetchKey },
  );
  const event = events?.[0];

  if (!event) {
    if (fetchPolicy !== "store-only") {
      return <Redirect href="/" />;
    }

    return (
      <EventLayout title={fallbackTitle}>
        <View className="px-5 py-6">
          <EventEmptyState
            title="Event unavailable"
            message="This event may have ended or been updated. Browse Events to see what's coming up."
          />
        </View>
      </EventLayout>
    );
  }

  const parsedDate = event.eventDate ? parseISO(event.eventDate) : null;
  const validDate = parsedDate && isValid(parsedDate) ? parsedDate : null;
  const title =
    eventText(event.eventTitle) ?? eventText(event.pageTitle) ?? "Event";
  const description = eventText(event.description);
  const speakers =
    event.eventSpeakers?.filter((speaker) => speaker.fullName?.trim()) ?? [];
  const eventUrl = `https://hccnj.org/news-and-events/${(eventText(event.slug) ?? slug).replace(/^\/+/, "")}`;
  // The server answers null when the event page has no rich text.
  const body = Option.getOrNull(
    Schema.decodeUnknownOption(RichDocument)(event.content),
  );
  // Services held more than once a day, such as 9:00 and 11:00, list every time.
  const sessionTimes = eventSessionTimes(
    event.sessions,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  return (
    <EventLayout title={title} showTitle={showHeaderTitle}>
      <StyledAnimatedScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 12 }}
      >
        <View className="gap-3 px-5">
          <View className="gap-1">
            <View className="flex-row items-center gap-2">
              <View className="bg-design-accent h-1.5 w-1.5 rounded-full" />
              <Text
                variant="caption/medium"
                color="designAccent"
                transform="uppercase"
                className="flex-1 tracking-[1.5px]"
              >
                {eventText(event.pageName) ?? "You're invited"}
              </Text>
            </View>
            <Text
              onLayout={onTitleLayout}
              accessibilityRole="header"
              selectable
              variant="heading/bold"
              color="designPrimary"
              className="tracking-[-0.8px]"
            >
              {title}
            </Text>
            {description ? (
              <Text
                selectable
                variant="caption/regular"
                color="designMuted"
                className="leading-[19px]"
              >
                {description}
              </Text>
            ) : null}
          </View>

          {event.eventImageUrl ? (
            <View className="border-continuous bg-design-overlay aspect-video w-full overflow-hidden rounded-xl">
              <Image
                source={event.eventImageUrl}
                accessibilityLabel={`${title} event artwork`}
                contentFit="cover"
                cachePolicy="disk"
                enforceEarlyResizing
                className="h-full w-full"
              />
            </View>
          ) : null}

          <View className="border-continuous border-design-border bg-design-surface gap-2.5 rounded-[24px] border p-3.5">
            <EventFact icon="calendar-days" label="Date">
              {validDate
                ? format(validDate, "EEEE, MMMM d, yyyy")
                : "To be announced"}
            </EventFact>
            <View className="bg-design-border h-px" />
            <EventFact
              icon="clock"
              label={sessionTimes.length > 1 ? "Times" : "Time"}
            >
              {sessionTimes.length > 1
                ? sessionTimes.join("\n")
                : validDate
                  ? formatTZ(validDate, "h:mm a zzz")
                  : (eventText(event.eventTime) ?? "To be announced")}
            </EventFact>
            <View className="bg-design-border h-px" />
            <EventFact icon="location-dot" label="Campus">
              {campusName}
            </EventFact>
          </View>

          {body ? (
            <View className="gap-2">
              <Text
                accessibilityRole="header"
                variant="titleLg/medium"
                color="designPrimary"
              >
                About this event
              </Text>
              <RichText content={body} comfortable color="designPrimary" />
            </View>
          ) : null}

          {speakers.length > 0 ? (
            <View className="bg-background-surface-muted/40 -mx-5 gap-2 py-3">
              <Text
                accessibilityRole="header"
                variant="headingXs/medium"
                color="designPrimary"
                className="px-5"
              >
                {speakers.length > 1 ? "Speakers" : "Speaker"}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={speakers.length > 2}
                contentInsetAdjustmentBehavior="never"
                contentContainerStyle={speakerContentStyle}
              >
                {speakers.map((speaker, index) => (
                  <View
                    key={`${speaker.fullName}-${index}`}
                    className="w-25 gap-2"
                  >
                    {speaker.image ? (
                      <Image
                        source={speaker.image}
                        alt={speaker.fullName ?? "Event speaker"}
                        contentFit="cover"
                        contentPosition="top"
                        cachePolicy="disk"
                        enforceEarlyResizing
                        className="rounded-m bg-background-surface-muted h-25 w-25"
                      />
                    ) : (
                      <View className="rounded-m bg-background-surface-muted h-25 w-25 items-center justify-center">
                        <FontAwesome6
                          name="user"
                          size={24}
                          color={colors.accent}
                        />
                      </View>
                    )}
                    <Text
                      variant="labelXXs/regular"
                      color="designPrimary"
                      numberOfLines={2}
                      className="w-full"
                    >
                      {speaker.fullName}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {event.zoomLink?.trim() ? (
            <Link
              href={event.zoomLink.trim()}
              accessibilityLabel="Join this event on Zoom"
              className="border-continuous border-design-border bg-design-surface active:bg-design-selected flex-row items-center gap-3 rounded-[20px] border p-4"
            >
              <FontAwesome6 name="video" size={20} color={colors.accent} />
              <View className="flex-1 gap-1">
                <Text variant="bodyLg/medium" color="designPrimary">
                  Join online
                </Text>
                <Text variant="caption/regular" color="designMuted">
                  Open this event on Zoom
                </Text>
              </View>
              <FontAwesome6
                name="arrow-up-right-from-square"
                size={15}
                color={colors.accent}
              />
            </Link>
          ) : null}
        </View>
      </StyledAnimatedScrollView>

      <View
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        className="border-design-border bg-design-chrome border-t px-5 pt-3"
      >
        <Link
          href={eventUrl}
          accessibilityLabel={`View ${title} on the church website`}
          className="border-continuous bg-design-text min-h-14 flex-row items-center justify-center gap-3 rounded-[20px] px-5 py-4 active:opacity-70"
        >
          <Text variant="bodyLg/medium" color="designBackground">
            View event page
          </Text>
          <FontAwesome6
            name="arrow-up-right-from-square"
            size={16}
            color={colors.background}
          />
        </Link>
      </View>
    </EventLayout>
  );
}
