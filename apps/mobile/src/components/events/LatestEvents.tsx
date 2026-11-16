import { isValid, parseISO } from "date-fns";
import { graphql, useLazyLoadQuery } from "react-relay";

import { useRetryKey } from "@/components/providers/ErrorBoundaryWithRetry";
import { useConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";

import { LatestEventsQuery } from "./__generated__/LatestEventsQuery.graphql";
import { EventAgenda, type EventMonthSection } from "./EventAgenda";

interface LatestEvent {
  name: string;
  startDate: string;
  slug: string;
  description?: string;
  speakerImages?: readonly string[];
}

const LatestEventsQ = graphql`
  query LatestEventsQuery($campusSlug: String!) {
    upcomingEventsByMonth(campusSlug: $campusSlug) {
      __typename
      ... on UpcomingEventsByMonthSuccess {
        months {
          month
          year
          events {
            eventTitle
            eventDate
            description
            slug
            eventSpeakers {
              image
            }
          }
        }
      }
      ... on UpcomingEventsByMonthFetchError {
        message
      }
    }
  }
`;

export function LatestEvents({ campusSlug }: { campusSlug: string }) {
  // store-and-network renders cached events instantly and refetches on every
  // mount; store-or-network would pin the list to the persisted cache forever.
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const fetchKey = useRetryKey(fetchPolicy);
  const { upcomingEventsByMonth } = useLazyLoadQuery<LatestEventsQuery>(
    LatestEventsQ,
    { campusSlug },
    {
      fetchPolicy,
      fetchKey,
    },
  );

  if (upcomingEventsByMonth?.__typename === "UpcomingEventsByMonthFetchError") {
    // Surface the typed fetch error to ErrorBoundaryWithRetry, matching the
    // retry UX the old flat `events` query got from top-level GraphQL errors.
    throw new Error(
      upcomingEventsByMonth.message ?? "Unable to load upcoming events",
    );
  }

  const months =
    upcomingEventsByMonth?.__typename === "UpcomingEventsByMonthSuccess"
      ? (upcomingEventsByMonth.months ?? [])
      : [];

  const sections: EventMonthSection[] = [];
  for (const monthGroup of months) {
    if (!monthGroup.month || monthGroup.year == null) {
      continue;
    }

    const events: LatestEvent[] = [];
    for (const event of monthGroup.events ?? []) {
      if (!event.eventDate || !event.eventTitle || !event.slug) {
        continue;
      }

      if (!isValid(parseISO(event.eventDate))) {
        continue;
      }

      events.push({
        name: event.eventTitle,
        startDate: event.eventDate,
        slug: event.slug,
        description: event.description ?? undefined,
        speakerImages: event.eventSpeakers?.flatMap((speaker) => {
          const image = speaker.image?.trim();
          return image ? [image] : [];
        }),
      });
    }

    if (events.length === 0) {
      continue;
    }

    sections.push({
      key: `${monthGroup.year}-${monthGroup.month}`,
      title: monthGroup.month,
      year: monthGroup.year,
      events,
    });
  }

  return <EventAgenda months={sections} />;
}
