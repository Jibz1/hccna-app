import { graphql, useMutation } from "react-relay";

import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

import {
  AttendanceExportFormat,
  EventAttendanceExportEventInput,
  useExportEventAttendanceMutation as UseExportEventAttendanceMutationType,
} from "./__generated__/useExportEventAttendanceMutation.graphql";

const ExportEventAttendanceMutation = graphql`
  mutation useExportEventAttendanceMutation(
    $input: [EventAttendanceExportEventInput!]!
    $occurrenceDate: String!
    $format: AttendanceExportFormat
  ) {
    exportEventAttendancePdf(
      input: $input
      occurrenceDate: $occurrenceDate
      format: $format
    ) {
      dataHash
      exportKey
      format
      generated
      lastGeneratedAt
      url
    }
  }
`;

type ExportEventAttendanceArgs = {
  format: AttendanceExportFormat;
  input: readonly EventAttendanceExportEventInput[];
  occurrenceDate: string;
};

export const useExportEventAttendanceMutation = () => {
  const [commitMutation, isInFlight] =
    useMutation<UseExportEventAttendanceMutationType>(
      ExportEventAttendanceMutation,
    );

  const exportEventAttendancePdf = ({
    input,
    occurrenceDate,
    format,
  }: ExportEventAttendanceArgs) => {
    return new Promise<{
      dataHash: string | null | undefined;
      exportKey: string | null | undefined;
      format: AttendanceExportFormat | null | undefined;
      generated: boolean | null | undefined;
      lastGeneratedAt: string | null | undefined;
      url: string | null | undefined;
    }>((resolve, reject) => {
      commitMutation({
        variables: {
          input,
          occurrenceDate,
          format,
        },
        onCompleted: (response) => {
          const exportResult = response.exportEventAttendancePdf;

          if (!exportResult) {
            reject(new Error("Export did not return a result."));
            return;
          }
          statsig.logEvent(
            "export_event_attendance_pdf_success",
            "export_event_attendance_pdf",
            {
              eventIds: input.map((item) => item.eventId).join(","),
              occurrenceDate,
              format,
              generated: String(exportResult?.generated ?? false),
            },
          );

          resolve(exportResult);
        },
        onError: (error) => {
          console.error("Error exporting event attendance:", error);
          captureException(error);
          reject(error);
        },
      });
    });
  };

  return {
    exportEventAttendancePdf,
    isInFlight,
  };
};
