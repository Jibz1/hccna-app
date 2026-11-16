import { useRouter } from "expo-router";
import { Suspense, useState } from "react";
import { View } from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { ProfileSettingsRow } from "@/components/profile/ProfileSettingsRow";
import {
  useRetryKey,
  ErrorBoundaryWithRetry,
} from "@/components/providers/ErrorBoundaryWithRetry";

import { EventAttendancesQuery as EventAttendancesQueryType } from "./__generated__/EventAttendancesQuery.graphql";

const EventAttendancesQuery = graphql`
  query EventAttendancesQuery {
    kidsEventAttendance {
      ccbEventId
      ccbGroupId
      eventDescription
      eventName
    }
  }
`;

function EventAttendancesImpl() {
  const { navigate } = useRouter();
  const [expanded, setExpanded] = useState(false);
  const fetchKey = useRetryKey();
  const { kidsEventAttendance } = useLazyLoadQuery<EventAttendancesQueryType>(
    EventAttendancesQuery,
    {},
    {
      fetchKey,
      fetchPolicy: "store-or-network",
    },
  );
  const attendanceEvents = (kidsEventAttendance ?? []).filter(
    (event) => event?.ccbEventId && event.ccbGroupId,
  );
  const attendanceEventCount = attendanceEvents.length;

  if (attendanceEventCount === 0) {
    return null;
  }
  return (
    <View className="border-continuous bg-design-surface overflow-hidden rounded-[28px]">
      <ProfileSettingsRow
        title="Event Check-In"
        icon="calendar-check"
        value={`${attendanceEventCount}`}
        expanded={expanded}
        last={!expanded}
        onPress={() => {
          setExpanded((value) => !value);
        }}
      />
      {expanded
        ? attendanceEvents.map((item, index) => (
            <ProfileSettingsRow
              key={`${item?.ccbEventId}-${item?.ccbGroupId}`}
              title={item?.eventName ?? "Event"}
              icon="clipboard-check"
              last={index === attendanceEventCount - 1}
              onPress={() => {
                navigate({
                  pathname: "/check-in",
                  params: {
                    ccbEventId: item?.ccbEventId ?? "",
                    ccbGroupId: item?.ccbGroupId ?? "",
                    eventName: item?.eventName ?? "",
                  },
                });
              }}
            />
          ))
        : null}
    </View>
  );
}

export function EventAttendances() {
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
        <EventAttendancesImpl />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}
