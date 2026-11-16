import { useRouter } from "expo-router";
import { Suspense } from "react";
import { View } from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { ProfileSettingsRow } from "@/components/profile/ProfileSettingsRow";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";

import { ExportEventAttendanceQuery } from "./__generated__/ExportEventAttendanceQuery.graphql";

const exportEventAttendanceCardQuery = graphql`
  query ExportEventAttendanceQuery {
    exportAttendance {
      exportAttendanceEvent {
        attendanceEventCCBID
        attendanceEventName
      }
    }
  }
`;

function ExportEventAttendanceImpl() {
  const { navigate } = useRouter();
  const fetchKey = useRetryKey();
  const data = useLazyLoadQuery<ExportEventAttendanceQuery>(
    exportEventAttendanceCardQuery,
    {},
    {
      fetchKey,
      fetchPolicy: "store-or-network",
    },
  );

  const exportableEvents = (
    data.exportAttendance?.exportAttendanceEvent ?? []
  ).flatMap((item) => {
    const attendanceEventCCBID = item?.attendanceEventCCBID?.trim();

    if (!attendanceEventCCBID) {
      return [];
    }

    return [
      {
        attendanceEventCCBID,
        attendanceEventName: item?.attendanceEventName?.trim() ?? "",
      },
    ];
  });

  if (exportableEvents.length === 0) {
    return null;
  }

  return (
    <View className="border-continuous bg-design-surface overflow-hidden rounded-[28px]">
      <ProfileSettingsRow
        title="Export Attendance"
        icon="download"
        last
        onPress={() => {
          navigate("/export-event-attendance");
        }}
      />
    </View>
  );
}

export function ExportEventAttendance() {
  return (
    <ErrorBoundaryWithRetry
      title="Something went wrong"
      subtitle="Please try again later"
      fallbackClassName="w-full"
    >
      <Suspense
        fallback={
          <View className="m-3xs flex-1 items-center justify-center">
            <FullLoadingState />
          </View>
        }
      >
        <ExportEventAttendanceImpl />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}
