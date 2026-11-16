import { useLocalSearchParams } from "expo-router";
import { Suspense } from "react";

import {
  DetailModalLayout,
  DetailModalSection,
} from "@/components/layout/DetailModalLayout";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { CastrChannelEditor } from "@/components/live/CastrChannelEditor";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import { HOUSE_OF_STARS_JUNIOR_CHURCH_SLUG } from "@/relay/campuses";
import { Text } from "@/ui/Text";

export default function CastrStreamScreen() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const campusSlug = (Array.isArray(slug) ? slug[0] : slug)?.trim();

  return (
    <DetailModalLayout
      title="Castr stream"
      closeLabel="Close Castr stream"
      testID="design-v2-castr-stream"
      keyboardAware
    >
      <ErrorBoundaryWithRetry
        title="Unable to load this stream"
        subtitle="Please try again later"
        fallbackContainer={DetailModalSection}
      >
        <Suspense
          fallback={
            <DetailModalSection>
              <FullLoadingState />
            </DetailModalSection>
          }
        >
          {campusSlug ? (
            <CastrChannelEditor
              campusSlug={campusSlug}
              showPreview={campusSlug === HOUSE_OF_STARS_JUNIOR_CHURCH_SLUG}
            />
          ) : (
            <DetailModalSection>
              <Text color="designMuted" variant="pXs/regular">
                Open a campus or Ministry Tools to manage a stream.
              </Text>
            </DetailModalSection>
          )}
        </Suspense>
      </ErrorBoundaryWithRetry>
    </DetailModalLayout>
  );
}
