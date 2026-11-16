import { Suspense } from "react";

import {
  HomeScreen as HomeContent,
  HomeLoadingState,
} from "@/components/home/HomeScreen";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import {
  useConnectivityAwareFetchPolicy,
  type ConnectivityAwareFetchPolicy,
} from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import {
  useHasCachedFeaturedEvents,
  useFeaturedEvents,
  useRefreshFeaturedEvents,
} from "@/hooks/relay/useFeaturedEvents";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";

function HomeScreenImpl({
  campusSlug,
  fetchPolicy,
}: {
  campusSlug: string;
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const fetchKey = useRetryKey(fetchPolicy);
  const featuredEvents = useFeaturedEvents({
    campusSlug,
    fetchKey,
    fetchPolicy,
  });
  const { refresh, refreshing } = useRefreshFeaturedEvents(
    campusSlug,
    fetchPolicy !== "store-only",
  );
  return (
    <HomeContent
      featuredEvents={featuredEvents}
      onRefresh={refresh}
      refreshing={refreshing}
    />
  );
}

export default function HomeScreen() {
  const campus = usePreferredCampus();
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedFeaturedEvents = useHasCachedFeaturedEvents(campus.slug);

  if (fetchPolicy === "store-only" && !hasCachedFeaturedEvents) {
    return <HomeContent featuredEvents={[]} />;
  }

  return (
    <ErrorBoundaryWithRetry
      key={campus.slug}
      title="Unable to load the home screen"
      subtitle="Please try again later"
      fallbackClassName="m-3xs"
    >
      <Suspense fallback=<HomeLoadingState />>
        <HomeScreenImpl campusSlug={campus.slug} fetchPolicy={fetchPolicy} />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}
