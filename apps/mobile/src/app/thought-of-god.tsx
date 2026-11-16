import { Suspense } from "react";

import { ThoughtOfGodSectionImpl } from "@/components/content/ThoughtOfGodImpl";
import {
  DetailModalLayout,
  DetailModalSection,
} from "@/components/layout/DetailModalLayout";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";

export default function ThoughtOfGodScreen() {
  return (
    <DetailModalLayout
      title="Thought of God"
      closeLabel="Close Thought of God"
      testID="design-v2-thought-of-god"
    >
      <ErrorBoundaryWithRetry
        title="Something went wrong"
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
          <ThoughtOfGodSectionImpl />
        </Suspense>
      </ErrorBoundaryWithRetry>
    </DetailModalLayout>
  );
}
