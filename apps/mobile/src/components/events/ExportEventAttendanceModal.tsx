import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useObservable, useValue } from "@legendapp/state/react";
import { format } from "date-fns";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { useRetryKey } from "@/components/providers/ErrorBoundaryWithRetry";
import { StyledLegendList as LegendList } from "@/cssInterop";
import { useExportEventAttendanceMutation } from "@/hooks/events/useExportEventAttendanceMutation";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { openInAppBrowser } from "@/utils/inAppBrowser";
import { cn } from "@/utils/styling";

import { ExportEventAttendanceModalQuery } from "./__generated__/ExportEventAttendanceModalQuery.graphql";
import {
  AttendanceEmptyState,
  AttendanceFooter,
  AttendanceSelectionMark,
} from "./AttendanceLayout";
import { WeekSundaySelector } from "./WeekSundaySelector";
import { getPreviousSunday } from "./WeekSundaySelector.utils";

type ExportEventItem = {
  attendanceEventCCBID: string;
  attendanceEventName: string;
};

type ExportFormat = "CSV" | "PDF";

const ESTIMATED_EXPORT_ROW_SIZE = 72;

const exportEventAttendanceModalQuery = graphql`
  query ExportEventAttendanceModalQuery {
    exportAttendance {
      exportAttendanceEvent {
        attendanceEventCCBID
        attendanceEventName
      }
    }
  }
`;

const ItemSeparator = function ItemSeparator() {
  return <View className="h-2" />;
};

function ExportEventRow({
  checked,
  eventId,
  eventName,
  disabled,
  onToggle,
}: {
  checked: boolean;
  eventId: string;
  eventName: string;
  disabled: boolean;
  onToggle: (eventId: string) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={() => {
        onToggle(eventId);
      }}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={eventName || "Unnamed event"}
      accessibilityState={{ checked, disabled }}
      className={cn(
        "border-continuous min-h-19 flex-row items-center gap-3 rounded-[20px] border p-4 active:opacity-70",
        checked
          ? "bg-design-selected border-design-accent/30"
          : "bg-design-surface border-design-border",
      )}
    >
      <View className="bg-design-surface-strong h-10 w-10 items-center justify-center rounded-[14px]">
        <FontAwesome6 name="calendar-check" size={16} color={colors.accent} />
      </View>
      <Text
        variant="body/medium"
        color="designPrimary"
        className="min-w-0 flex-1"
      >
        {eventName || "Unnamed event"}
      </Text>
      <AttendanceSelectionMark checked={checked} />
    </Pressable>
  );
}

export function ExportEventAttendanceModal() {
  const { colors } = useAppTheme();
  const [isOpeningExport, setIsOpeningExport] = useState(false);
  const fetchKey = useRetryKey();
  const data = useLazyLoadQuery<ExportEventAttendanceModalQuery>(
    exportEventAttendanceModalQuery,
    {},
    {
      fetchKey,
      fetchPolicy: "store-or-network",
    },
  );
  const { exportEventAttendancePdf, isInFlight } =
    useExportEventAttendanceMutation();

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

  const selectedIds$ = useObservable<string[]>([]);
  const selectedDate$ = useObservable<Date>(getPreviousSunday);
  const selectedFormat$ = useObservable<ExportFormat>("PDF");
  const selectedIds = useValue(selectedIds$);
  const selectedDate = useValue(selectedDate$);
  const selectedFormat = useValue(selectedFormat$);
  const availableEventIds = new Set(
    exportableEvents.map((event) => event.attendanceEventCCBID),
  );
  const validSelectedIds = selectedIds.filter((id) =>
    availableEventIds.has(id),
  );
  const selectedIdSet = new Set(validSelectedIds);
  const isExporting = isInFlight || isOpeningExport;
  const allSelected =
    exportableEvents.length > 0 &&
    exportableEvents.every((event) =>
      selectedIdSet.has(event.attendanceEventCCBID),
    );

  const formattedOccurrenceDate = format(selectedDate, "yyyy-MM-dd");

  function toggleEvent(eventId: string) {
    selectedIds$.set((current) =>
      current.includes(eventId)
        ? current.filter((selectedId) => selectedId !== eventId)
        : [...current, eventId],
    );
  }

  function renderItem({
    item,
    extraData,
  }: {
    item: ExportEventItem;
    extraData: Set<string>;
  }) {
    return (
      <ExportEventRow
        eventId={item.attendanceEventCCBID}
        eventName={item.attendanceEventName}
        checked={extraData.has(item.attendanceEventCCBID)}
        disabled={isExporting}
        onToggle={toggleEvent}
      />
    );
  }

  const exportDisabled = validSelectedIds.length === 0 || isExporting;
  const eventCountLabel = `${validSelectedIds.length} ${validSelectedIds.length === 1 ? "event" : "events"}`;

  const listHeader = (
    <View className="gap-6 pb-3">
      <View className="gap-2 px-1">
        <Text
          accessibilityRole="header"
          variant="titleLg/bold"
          color="designPrimary"
        >
          Attendance, ready to share.
        </Text>
        <Text variant="body/regular" color="designMuted">
          Choose a week and the events to include in your report.
        </Text>
      </View>
      <WeekSundaySelector
        value={selectedDate}
        maxWeek={getPreviousSunday()}
        disabled={isExporting}
        onChange={(date) => {
          selectedDate$.set(date);
        }}
      />
      <View className="gap-3">
        <Text
          accessibilityRole="header"
          variant="bodyLg/bold"
          color="designPrimary"
        >
          File format
        </Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Export file format"
          className="flex-row gap-3"
        >
          {(["PDF", "CSV"] as const).map((formatOption) => {
            const selected = selectedFormat === formatOption;
            return (
              <Pressable
                key={formatOption}
                onPress={() => {
                  selectedFormat$.set(formatOption);
                }}
                disabled={isExporting}
                accessibilityLabel={`${formatOption}, ${formatOption === "PDF" ? "ready to print or share" : "open in a spreadsheet"}`}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: selected,
                  disabled: isExporting,
                }}
                className={cn(
                  "border-continuous flex-1 gap-4 rounded-[22px] border p-4 active:opacity-70",
                  selected
                    ? "bg-design-selected border-design-accent/40"
                    : "bg-design-surface border-design-border",
                )}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <FontAwesome6
                    name={formatOption === "PDF" ? "file-pdf" : "file-csv"}
                    size={24}
                    color={selected ? colors.accent : colors.textMuted}
                  />
                  <View
                    className={cn(
                      "h-5 w-5 items-center justify-center rounded-full border",
                      selected
                        ? "border-design-accent"
                        : "border-design-text-muted/40",
                    )}
                  >
                    {selected ? (
                      <View className="bg-design-accent h-2.5 w-2.5 rounded-full" />
                    ) : null}
                  </View>
                </View>
                <View className="gap-1">
                  <Text variant="bodyLg/bold" color="designPrimary">
                    {formatOption}
                  </Text>
                  <Text variant="captionSm/regular" color="designMuted">
                    {formatOption === "PDF"
                      ? "Print or share"
                      : "Use in a spreadsheet"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Text
            accessibilityRole="header"
            variant="bodyLg/bold"
            color="designPrimary"
          >
            Events
          </Text>
          <View className="bg-design-selected rounded-full px-2.5 py-1">
            <Text variant="captionSm/medium" color="designAccent">
              {validSelectedIds.length} / {exportableEvents.length}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={isExporting}
          accessibilityState={{ disabled: isExporting }}
          onPress={() => {
            selectedIds$.set(allSelected ? [] : Array.from(availableEventIds));
          }}
          className="min-h-11 items-center justify-center px-1 active:opacity-60"
        >
          <Text variant="caption/medium" color="designAccent">
            {allSelected ? "Deselect all" : "Select all"}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  if (exportableEvents.length === 0) {
    return (
      <View className="flex-1 justify-center">
        <AttendanceEmptyState
          title="No attendance to export"
          message="Events available to your account will appear here when they are ready to export."
          icon="file-arrow-down"
        />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <LegendList
        recycleItems
        data={exportableEvents}
        extraData={{ selectedIdSet, isExporting }}
        estimatedItemSize={ESTIMATED_EXPORT_ROW_SIZE}
        className="w-full flex-1"
        contentContainerClassName="px-5 pt-2 pb-6"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        ItemSeparatorComponent={ItemSeparator}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) =>
          renderItem({ item, extraData: selectedIdSet })
        }
        keyExtractor={(item) => item.attendanceEventCCBID}
      />
      <AttendanceFooter
        disabled={exportDisabled}
        loading={isExporting}
        icon="file-arrow-down"
        label={isExporting ? "Preparing export…" : `Export ${selectedFormat}`}
        summary={`${eventCountLabel} · Week of ${format(selectedDate, "MMM d, yyyy")}`}
        hint={
          validSelectedIds.length === 0
            ? "Select at least one event to create your report."
            : `${selectedFormat} report · Opens when ready`
        }
        onPress={async () => {
          setIsOpeningExport(true);
          try {
            const exportResult = await exportEventAttendancePdf({
              input: validSelectedIds.map((eventId) => ({ eventId })),
              occurrenceDate: formattedOccurrenceDate,
              format: selectedFormat,
            });
            const exportUrl = exportResult.url?.trim();
            if (!exportUrl) {
              toast.error({
                title: "Unable to export attendance",
                message: "No download was returned. Please try again.",
              });
              return;
            }
            await openInAppBrowser(exportUrl);
            toast.success({ title: `Attendance ${selectedFormat} ready` });
          } catch (error) {
            toast.error({
              title: "Unable to export attendance",
              message:
                error instanceof Error
                  ? error.message
                  : "Please try again later.",
            });
          } finally {
            setIsOpeningExport(false);
          }
        }}
      />
    </View>
  );
}
