import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchQuery,
  graphql,
  useLazyLoadQuery,
  useRelayEnvironment,
} from "react-relay";
import { createOperationDescriptor, getRequest } from "relay-runtime";
import { toast } from "sonner-native";

import type { FeaturedEventsQuery } from "@/hooks/relay/__generated__/FeaturedEventsQuery.graphql";
import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import {
  resolveFeaturedEvents,
  type FeaturedEventData,
} from "@/relay/featuredEvents";

export const FeaturedEventsQueryDocument = graphql`
  query FeaturedEventsQuery($campusSlug: String!) {
    featuredEvents(campusSlug: $campusSlug) {
      __typename
      ... on FeaturedEventsSuccess {
        events {
          eventTitle
          description
          eventImageUrl
          pageLink
          prominentColors {
            accent
            dark
            light
          }
          slug
        }
      }
      ... on FeaturedEventsFetchError {
        message
      }
      ... on FeaturedEventsNotFoundError {
        message
      }
    }
  }
`;

export function useHasCachedFeaturedEvents(campusSlug: string): boolean {
  const environment = useRelayEnvironment();
  const operation = createOperationDescriptor(
    getRequest(FeaturedEventsQueryDocument),
    {
      campusSlug,
    },
  );

  if (environment.check(operation).status !== "available") {
    return false;
  }

  const snapshot = environment.lookup(operation.fragment);
  const result = snapshot.data as FeaturedEventsQuery["response"];
  return result.featuredEvents?.__typename === "FeaturedEventsSuccess";
}

export function useFeaturedEvents({
  campusSlug,
  fetchKey,
  fetchPolicy,
}: {
  campusSlug: string;
  fetchKey: string;
  fetchPolicy: ConnectivityAwareFetchPolicy;
}): readonly FeaturedEventData[] {
  const result = useLazyLoadQuery<FeaturedEventsQuery>(
    FeaturedEventsQueryDocument,
    { campusSlug },
    {
      fetchKey,
      fetchPolicy,
    },
  );

  return resolveFeaturedEvents(result.featuredEvents);
}

export function useRefreshFeaturedEvents(campusSlug: string, online: boolean) {
  const environment = useRelayEnvironment();
  const [refreshing, setRefreshing] = useState(false);
  const subscription = useRef<{ unsubscribe(): void } | null>(null);

  useEffect(() => () => subscription.current?.unsubscribe(), []);

  const refresh = useCallback(() => {
    if (!online || subscription.current) {
      return;
    }
    setRefreshing(true);
    const finish = () => {
      subscription.current = null;
      setRefreshing(false);
    };
    fetchQuery<FeaturedEventsQuery>(
      environment,
      FeaturedEventsQueryDocument,
      { campusSlug },
      {
        fetchPolicy: "network-only",
      },
    ).subscribe({
      start: (next) => {
        subscription.current = next;
      },
      complete: finish,
      error: () => {
        finish();
        toast.error("Unable to refresh featured events. Please try again.");
      },
    });
  }, [campusSlug, environment, online]);

  return { refresh, refreshing };
}
