import { router, useLocalSearchParams } from "expo-router";
import { Suspense, useEffect } from "react";
import { View } from "react-native";

import { EventDetail } from "@/components/events/EventDetail";
import { EventLayout } from "@/components/events/EventLayout";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import { statsig } from "@/utils/statsig";

export default function EventModalScreen() {
  const campus = usePreferredCampus();
  const params = useLocalSearchParams<{
    slug?: string | string[];
    title?: string | string[];
  }>();
  const slug = (
    Array.isArray(params.slug) ? params.slug[0] : params.slug
  )?.trim();
  const title =
    (Array.isArray(params.title) ? params.title[0] : params.title)
      ?.replace(/\s+/g, " ")
      .trim() ?? "Event";

  useEffect(() => {
    if (slug) {
      return;
    }
    statsig.logEvent("slug_error", "event-modal", { slug: "" });
    router.replace("/");
  }, [slug]);

  if (!slug) {
    return null;
  }

  return (
    <ErrorBoundaryWithRetry
      key={`${slug}:${campus.slug}`}
      title="Unable to load this event"
      subtitle="Please try again later"
      fallbackClassName="mx-5"
      fallbackRender={(fallback) => (
        <EventLayout title={title}>{fallback}</EventLayout>
      )}
    >
      <Suspense
        fallback={
          <EventLayout title={title} showTitle={false}>
            <View className="flex-1 items-center justify-center">
              <FullLoadingState />
            </View>
          </EventLayout>
        }
      >
        <EventDetail
          slug={slug}
          campusSlug={campus.slug}
          campusName={campus.campusName}
          fallbackTitle={title}
        />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}
