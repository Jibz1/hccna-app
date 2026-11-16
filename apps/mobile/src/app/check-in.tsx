import { useLocalSearchParams } from "expo-router";
import { Suspense, useEffect } from "react";

import { AttendanceLayout } from "@/components/events/AttendanceLayout";
import { EventCheckIn } from "@/components/events/EventCheckIn";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { goBackOrReplace } from "@/utils/navigation";
import { statsig } from "@/utils/statsig";

export default function CheckInScreen() {
  const params = useLocalSearchParams<{
    ccbEventId?: string | string[];
    ccbGroupId?: string | string[];
    eventName?: string | string[];
  }>();
  const user = useUserProfile();
  const eventID = (
    Array.isArray(params.ccbEventId) ? params.ccbEventId[0] : params.ccbEventId
  )?.trim();
  const eventGroupId = (
    Array.isArray(params.ccbGroupId) ? params.ccbGroupId[0] : params.ccbGroupId
  )?.trim();
  const eventName = Array.isArray(params.eventName)
    ? params.eventName[0]
    : params.eventName;
  const hasValidParams = Boolean(eventID && eventGroupId);

  useEffect(() => {
    if (hasValidParams) {
      return;
    }
    statsig.logEvent("slug_error", "check-in", {
      ccbEventId: eventID ?? "",
      ccbGroupId: eventGroupId ?? "",
    });
    goBackOrReplace("/ministry-tools");
  }, [eventGroupId, eventID, hasValidParams]);

  if (!eventID || !eventGroupId) {
    return null;
  }

  return (
    <AttendanceLayout title="Event check-in">
      <ErrorBoundaryWithRetry
        title="Unable to load attendance"
        subtitle="Please try again."
      >
        <Suspense fallback=<FullLoadingState />>
          {user ? (
            <EventCheckIn
              key={`${eventID}:${eventGroupId}`}
              ccbEventId={eventID}
              ccbGroupId={eventGroupId}
              eventName={
                eventName?.trim() ? eventName.trim() : "Event attendance"
              }
            />
          ) : (
            <FullLoadingState />
          )}
        </Suspense>
      </ErrorBoundaryWithRetry>
    </AttendanceLayout>
  );
}
