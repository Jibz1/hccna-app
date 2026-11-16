import { Option, Schema } from "effect";
import { router, useLocalSearchParams } from "expo-router";
import { Suspense, useEffect } from "react";
import { type LayoutChangeEvent, View } from "react-native";

import { CampusesUnavailable } from "@/components/campuses/CampusesUnavailable";
import { CampusFollowBell } from "@/components/campuses/CampusFollowBell";
import { CampusLeads } from "@/components/campuses/CampusLeads";
import { CampusSocialLinks } from "@/components/campuses/CampusSocialLinks";
import { PreferredCampusChip } from "@/components/campuses/PreferredCampusChip";
import { RichDocument, RichText } from "@/components/content/RichText";
import { GivingCard } from "@/components/giving/GivingCard";
import {
  DetailModalLayout,
  DetailModalSection,
} from "@/components/layout/DetailModalLayout";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { Castr } from "@/components/live/Castr";
import { StreamEditor } from "@/components/live/StreamEditor";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import {
  useCachedCampuses,
  useCampuses,
  useHasCachedCampuses,
} from "@/hooks/relay/useCampuses";
import {
  type ConnectivityAwareFetchPolicy,
  useConnectivityAwareFetchPolicy,
} from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import { useScrollHeaderTitle } from "@/hooks/useScrollHeaderTitle";
import { getCampusBySlug, PRIMARY_CAMPUS_SLUG } from "@/relay/campuses";
import { Text } from "@/ui/Text";
import { statsig } from "@/utils/statsig";

function CampusModalScreenImpl({
  fetchPolicy,
  normalizedSlug,
  onTitleLayout,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
  normalizedSlug: string;
  onTitleLayout: (event: LayoutChangeEvent) => void;
}) {
  const preferredCampus = usePreferredCampus();
  const fetchKey = useRetryKey(fetchPolicy);
  const campuses = useCampuses({ fetchKey, fetchPolicy });
  const campus = getCampusBySlug(campuses, normalizedSlug);
  const shouldDismiss = fetchPolicy !== "store-only" && !campus;
  const content = Option.getOrNull(
    Schema.decodeUnknownOption(RichDocument)(campus?.content),
  );
  const isPreferred =
    preferredCampus.isAuthenticated &&
    preferredCampus.isLoaded &&
    preferredCampus.slug === campus?.slug;

  useEffect(() => {
    if (!shouldDismiss) {
      return;
    }
    statsig.logEvent("slug_error", "campus-modal", {
      slug: normalizedSlug,
    });
    router.replace("/");
  }, [shouldDismiss, normalizedSlug]);

  if (shouldDismiss) {
    return null;
  }

  if (!campus) {
    return (
      <DetailModalSection>
        <CampusesUnavailable />
      </DetailModalSection>
    );
  }

  return (
    <>
      <DetailModalSection>
        <View className="gap-3xs">
          <View className="gap-6xs">
            <View className="gap-4xs flex-row items-center">
              <Text
                onLayout={onTitleLayout}
                accessibilityRole="header"
                variant="title/bold"
                color="designPrimary"
                className="flex-1"
              >
                {campus.campusName}
              </Text>
              <CampusFollowBell
                campusSlug={campus.slug}
                campusName={campus.campusName ?? "This campus"}
                isOwnCampus={preferredCampus.slug === campus.slug}
              />
            </View>
            {campus.location ? (
              <Text variant="pXs/regular" color="designMuted">
                {campus.location}
              </Text>
            ) : null}
          </View>
          <PreferredCampusChip
            campusSlug={campus.slug}
            campusName={campus.campusName ?? "This campus"}
            isPreferred={isPreferred}
            preferredCampus={preferredCampus}
          />
        </View>
      </DetailModalSection>
      <Suspense fallback=<FullLoadingState />>
        <Castr
          presentation="fullWidth"
          image={campus.image ?? ""}
          streamLink={campus.streamLink ?? undefined}
        />
      </Suspense>

      <DetailModalSection>
        <StreamEditor campusSlug={campus.slug} />
        {content ? (
          <View className="p-3xs bg-design-surface-strong border-design-border rounded-[26px] border">
            <RichText content={content} comfortable color="designPrimary" />
          </View>
        ) : null}
        <CampusLeads campusLeads={campus.campusLeads} />
        {campus.giving && (campus.givingPlatforms?.length ?? 0) > 0 ? (
          <View className="gap-3xs p-3xs bg-design-surface-strong border-design-border rounded-[26px] border">
            <Text
              accessibilityRole="header"
              variant="bodyLg/bold"
              color="designPrimary"
            >
              Giving
            </Text>
            {campus.givingPlatforms?.map((platform, index) => (
              <GivingCard
                key={`${campus.slug}:${platform.title ?? "platform"}:${index}`}
                title={platform.title?.trim() ? platform.title : "Website"}
                icon={platform.icon ?? ""}
                link={
                  platform.link ??
                  (normalizedSlug === PRIMARY_CAMPUS_SLUG
                    ? (campus.giving ?? "")
                    : "")
                }
                text={platform.link ? undefined : (platform.text ?? undefined)}
              />
            ))}
          </View>
        ) : null}
        <CampusSocialLinks
          facebook={campus.facebook}
          instagram={campus.instagram}
        />
      </DetailModalSection>
    </>
  );
}

export default function CampusDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const slugParam = Array.isArray(slug) ? slug[0] : slug;
  const normalizedSlug = slugParam?.replace(/^\/+|\/+$/g, "");
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedCampuses = useHasCachedCampuses();
  const cachedCampuses = useCachedCampuses();
  const campus = getCampusBySlug(cachedCampuses, normalizedSlug);
  const { showHeaderTitle, onScroll, onTitleLayout, onContentLayout } =
    useScrollHeaderTitle();
  const shouldDismiss = !normalizedSlug;

  useEffect(() => {
    if (!shouldDismiss) {
      return;
    }
    statsig.logEvent("slug_error", "campus-modal", {
      slug: normalizedSlug ?? "",
    });
    router.replace("/");
  }, [shouldDismiss, normalizedSlug]);

  if (shouldDismiss) {
    return null;
  }

  const campusTitle = campus?.campusName ?? "";

  return (
    <DetailModalLayout
      title={campusTitle.length > 0 ? campusTitle : "Campus"}
      showTitle={showHeaderTitle}
      onScroll={onScroll}
      onContentLayout={onContentLayout}
      closeLabel="Close campus"
      testID="design-v2-campus"
    >
      {fetchPolicy === "store-only" && !hasCachedCampuses ? (
        <DetailModalSection>
          <CampusesUnavailable />
        </DetailModalSection>
      ) : (
        <ErrorBoundaryWithRetry
          title="Unable to load this campus"
          subtitle="Please try again later"
          fallbackContainer={DetailModalSection}
        >
          <Suspense fallback=<FullLoadingState />>
            <CampusModalScreenImpl
              fetchPolicy={fetchPolicy}
              normalizedSlug={normalizedSlug}
              onTitleLayout={onTitleLayout}
            />
          </Suspense>
        </ErrorBoundaryWithRetry>
      )}
    </DetailModalLayout>
  );
}
