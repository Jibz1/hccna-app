import { graphql } from "react-relay";

import { useCheckedMutation } from "@/relay/mutations";
import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

import {
  useAttendanceMutation as UseAttendanceMutationType,
  UpdateEventAttendanceInput,
} from "./__generated__/useAttendanceMutation.graphql";

const AttendanceMutation = graphql`
  mutation useAttendanceMutation($input: UpdateEventAttendanceInput!) {
    createEventAttendance(input: $input) {
      message
      success
    }
  }
`;

export const useAttendanceMutation = () => {
  const [commitMutation, isInFlight] =
    useCheckedMutation<UseAttendanceMutationType>(AttendanceMutation, {
      selectResult: (response) => response.createEventAttendance,
      fallbackMessage: "Failed to submit check in",
    });

  const createEventAttendance = async (input: UpdateEventAttendanceInput) => {
    try {
      const response = await commitMutation({
        variables: {
          input: {
            ...input,
          },
        },
      });
      statsig.logEvent(
        "create_event_attendance_success",
        "create_event_attendance",
        {
          eventId: input.eventId,
          notes: input.notes,
          topic: input.topic,
        },
      );
      return response;
    } catch (error) {
      console.error("Error creating attendance:", error);
      captureException(error);
      throw error;
    }
  };

  return {
    createEventAttendance,
    isInFlight,
  };
};
