import { Suspense } from "react";

import { AttendanceLayout } from "@/components/events/AttendanceLayout";
import { ExportEventAttendanceModal } from "@/components/events/ExportEventAttendanceModal";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";

export default function ExportEventAttendanceScreen() {
  return (
    <AttendanceLayout title="Export attendance">
      <ErrorBoundaryWithRetry
        title="Unable to load attendance exports"
        subtitle="Please try again."
      >
        <Suspense fallback=<FullLoadingState />>
          <ExportEventAttendanceModal />
        </Suspense>
      </ErrorBoundaryWithRetry>
    </AttendanceLayout>
  );
}
