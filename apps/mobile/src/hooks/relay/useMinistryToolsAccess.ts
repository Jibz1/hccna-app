import { graphql, useLazyLoadQuery } from "react-relay";

import { useRetryKey } from "@/components/providers/ErrorBoundaryWithRetry";
import { useConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { HOUSE_OF_STARS_JUNIOR_CHURCH_SLUG } from "@/relay/campuses";

import type { MinistryToolsAccessQuery } from "./__generated__/MinistryToolsAccessQuery.graphql";

export function useMinistryToolsAccess() {
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const fetchKey = useRetryKey(fetchPolicy);
  const data = useLazyLoadQuery<MinistryToolsAccessQuery>(
    graphql`
      query MinistryToolsAccessQuery($campusSlug: String!) {
        kidsEventAttendance {
          ccbEventId
          ccbGroupId
          eventDescription
          eventName
        }
        castrStream(campusSlug: $campusSlug) {
          id
          name
          title
          platforms {
            id
            template
          }
        }
        exportAttendance {
          exportAttendanceEvent {
            attendanceEventCCBID
            attendanceEventName
          }
        }
      }
    `,
    { campusSlug: HOUSE_OF_STARS_JUNIOR_CHURCH_SLUG },
    { fetchKey, fetchPolicy },
  );

  const canCheckIn =
    data.kidsEventAttendance?.some(
      (event) => event?.ccbEventId && event.ccbGroupId,
    ) ?? false;
  const canEditStream = data.castrStream != null;
  const canExportAttendance =
    data.exportAttendance?.exportAttendanceEvent?.some((event) =>
      Boolean(event?.attendanceEventCCBID?.trim()),
    ) ?? false;

  return {
    canCheckIn,
    canEditStream,
    canExportAttendance,
    hasAccess: canCheckIn || canEditStream || canExportAttendance,
  };
}
