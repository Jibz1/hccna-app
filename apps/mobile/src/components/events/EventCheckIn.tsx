import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useObservable, useValue } from "@legendapp/state/react";
import { format, isValid, parseISO } from "date-fns";
import { Schema } from "effect";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { Pressable, TextInput, View } from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { Form } from "@/components/forms/Form";
import { DynamicKeyboardAvoidingView } from "@/components/layout/DynamicKeyboardAvoidingView";
import { useRetryKey } from "@/components/providers/ErrorBoundaryWithRetry";
import { StyledLegendList as LegendList } from "@/cssInterop";
import { useAttendanceMutation } from "@/hooks/events/useAttendanceMutation";
import { useZodForm } from "@/hooks/utils/useZodForm";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

import { EventCheckInQuery } from "./__generated__/EventCheckInQuery.graphql";
import {
  AttendanceEmptyState,
  AttendanceFooter,
  AttendanceSelectionMark,
} from "./AttendanceLayout";
import {
  getEventCheckInDefaultsKey,
  usePristineCheckInDefaultsSync,
} from "./EventCheckIn.state";

type EventCheckInProps = {
  ccbEventId: string;
  ccbGroupId: string;
  eventName: string;
};

type AttendeeItem = {
  attendeeCCBID: string;
  attendeeName: string;
};

const ESTIMATED_ATTENDEE_ROW_SIZE = 72;

function normalizeNameSearchValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getValidAttendeeIds(
  attendeeIds: readonly (string | null | undefined)[],
) {
  return attendeeIds.flatMap((attendeeId) => {
    const normalizedAttendeeId = attendeeId?.trim();
    return normalizedAttendeeId ? [normalizedAttendeeId] : [];
  });
}

const ItemSeparator = function ItemSeparator() {
  return <View className="h-2" />;
};

function AttendeeRow({
  attendeeId,
  attendeeName,
  checked,
  onToggle,
}: {
  attendeeId: string;
  attendeeName: string;
  checked: boolean;
  onToggle: (attendeeId: string) => void;
}) {
  const name = attendeeName.trim() || "Unnamed attendee";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <Pressable
      onPress={() => {
        onToggle(attendeeId);
      }}
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={{ checked }}
      className={cn(
        "border-continuous min-h-19 flex-row items-center gap-3 rounded-[20px] border p-4 active:opacity-70",
        checked
          ? "bg-design-selected border-design-accent/30"
          : "bg-design-surface border-design-border",
      )}
    >
      <View className="bg-design-surface-strong h-10 w-10 items-center justify-center rounded-full">
        <Text variant="caption/medium" color="designAccent">
          {initials}
        </Text>
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text variant="body/medium" color="designPrimary">
          {name}
        </Text>
        <Text
          variant="captionSm/regular"
          color={checked ? "designAccent" : "designMuted"}
        >
          {checked ? "Marked present" : "Tap to mark present"}
        </Text>
      </View>
      <AttendanceSelectionMark checked={checked} />
    </Pressable>
  );
}

function CheckInField({
  name,
  label,
  placeholder,
  multiline = false,
}: {
  name: "topic" | "notes";
  label: string;
  placeholder: string;
  multiline?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Controller
      name={name}
      render={({
        field: { value, onChange, onBlur, ref },
        fieldState: { error, isTouched },
      }) => (
        <View className="gap-2">
          <Text variant="caption/medium" color="designPrimary">
            {label} *
          </Text>
          <TextInput
            ref={ref}
            accessibilityLabel={`${label}, required`}
            value={value ?? ""}
            onChangeText={onChange}
            onBlur={onBlur}
            editable
            multiline={multiline}
            textAlignVertical={multiline ? "top" : "center"}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            autoCapitalize="sentences"
            className={cn(
              "border-continuous bg-design-surface-strong border-design-border text-design-text font-sans text-body min-h-13 rounded-[16px] border px-4 py-3",
              multiline && "min-h-24",
            )}
          />
          {error && isTouched ? (
            <Text
              accessibilityRole="alert"
              variant="captionSm/regular"
              color="designNegative"
            >
              {error.message}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

function CheckInListHeader({
  eventName,
  formattedDate,
  allSelected,
  onToggleAll,
  nameFilter,
  onNameFilterChange,
  attendeeCount,
  visibleCount,
  selectedCount,
}: {
  eventName: string;
  formattedDate?: string | null;
  allSelected: boolean;
  onToggleAll: () => void;
  nameFilter: string;
  onNameFilterChange: (value: string) => void;
  attendeeCount: number;
  visibleCount: number;
  selectedCount: number;
}) {
  const { colors } = useAppTheme();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const parsedDate = formattedDate ? parseISO(formattedDate) : null;
  const dateLabel =
    parsedDate && isValid(parsedDate)
      ? format(parsedDate, "EEEE, MMMM d, yyyy")
      : formattedDate;
  return (
    <View className="gap-6 pb-3">
      <View className="border-continuous bg-design-surface border-design-border gap-4 rounded-[28px] border p-5">
        <View className="flex-row items-center gap-2">
          <FontAwesome6 name="calendar-check" size={14} color={colors.accent} />
          <Text variant="caption/medium" color="designAccent">
            ATTENDANCE
          </Text>
        </View>
        <View className="gap-2">
          <Text
            accessibilityRole="header"
            variant="titleLg/bold"
            color="designPrimary"
          >
            {eventName}
          </Text>
          {dateLabel ? (
            <Text variant="body/regular" color="designMuted">
              {dateLabel}
            </Text>
          ) : null}
        </View>
        <View className="border-design-border flex-row flex-wrap items-baseline gap-x-2 gap-y-1 border-t pt-4">
          <Text variant="title/bold" color="designPrimary">
            {selectedCount}
          </Text>
          <Text variant="body/regular" color="designMuted">
            marked present · {attendeeCount} on the list
          </Text>
        </View>
      </View>

      <View className="border-continuous bg-design-surface border-design-border gap-4 rounded-[24px] border p-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Session details, topic and notes required"
          accessibilityState={{ expanded: detailsExpanded }}
          onPress={() => {
            setDetailsExpanded((current) => !current);
          }}
          className="min-h-11 flex-row items-center gap-3 active:opacity-60"
        >
          <View className="min-w-0 flex-1 gap-1">
            <Text variant="bodyLg/bold" color="designPrimary">
              Session details
            </Text>
            <Text variant="captionSm/regular" color="designMuted">
              Topic and notes · Required to save
            </Text>
          </View>
          <FontAwesome6
            name={detailsExpanded ? "chevron-up" : "chevron-down"}
            size={13}
            color={colors.textMuted}
          />
        </Pressable>
        {detailsExpanded ? (
          <View className="border-design-border gap-4 border-t pt-4">
            <CheckInField
              name="topic"
              label="Topic"
              placeholder="What did you cover?"
            />
            <CheckInField
              name="notes"
              label="Notes"
              placeholder="Add a few notes about this session…"
              multiline
            />
          </View>
        ) : null}
      </View>

      <View className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text
            accessibilityRole="header"
            variant="bodyLg/bold"
            color="designPrimary"
          >
            Attendees
          </Text>
          <Text variant="caption/regular" color="designMuted">
            {visibleCount} {nameFilter.trim() ? "found" : "people"}
          </Text>
        </View>
        <View className="bg-design-surface border-design-border min-h-13 flex-row items-center gap-3 rounded-[18px] border pr-1 pl-4">
          <FontAwesome6
            name="magnifying-glass"
            size={16}
            color={colors.textMuted}
          />
          <TextInput
            value={nameFilter}
            onChangeText={onNameFilterChange}
            placeholder="Search by name"
            accessibilityLabel="Search attendees by first and last name"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            className="text-design-text text-body min-h-13 min-w-0 flex-1 py-3 font-sans"
          />
          {nameFilter.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear attendee search"
              onPress={() => {
                onNameFilterChange("");
              }}
              className="h-11 w-11 items-center justify-center active:opacity-60"
            >
              <FontAwesome6 name="xmark" size={16} color={colors.textMuted} />
            </Pressable>
          ) : (
            <View className="w-3" />
          )}
        </View>
        {visibleCount > 0 ? (
          <Pressable
            onPress={onToggleAll}
            accessibilityRole="button"
            className="min-h-11 flex-row items-center justify-between gap-3 px-1 active:opacity-60"
          >
            <Text variant="caption/medium" color="designAccent">
              {allSelected ? "Deselect" : "Select"}{" "}
              {nameFilter.trim() ? "search results" : "all attendees"}
            </Text>
            <AttendanceSelectionMark checked={allSelected} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function EventCheckIn({
  ccbEventId,
  ccbGroupId,
  eventName,
}: EventCheckInProps) {
  const fetchKey = useRetryKey();
  const [nameFilter, setNameFilter] = useState("");
  const { eventWithAttendance } = useLazyLoadQuery<EventCheckInQuery>(
    graphql`
      query EventCheckInQuery($ccbEventId: String!, $ccbGroupId: String!) {
        eventWithAttendance(ccbGroupId: $ccbGroupId, eventID: $ccbEventId) {
          attendees {
            attendeeCCBID
            attendeeName
          }
          ccbEventId
          ccbGroupId
          attendanceRecordDate
          attendanceRecord {
            attendee
            notes
            topic
          }
        }
      }
    `,
    {
      ccbEventId,
      ccbGroupId,
    },
    {
      fetchPolicy: "network-only",
      fetchKey,
    },
  );

  const { createEventAttendance, isInFlight } = useAttendanceMutation();

  const selectedAttendees = getValidAttendeeIds(
    eventWithAttendance?.attendanceRecord?.attendee ?? [],
  );

  const attendees = (eventWithAttendance?.attendees ?? []).flatMap(
    (attendee) => {
      const attendeeCCBID = attendee?.attendeeCCBID?.trim();

      if (!attendeeCCBID) {
        return [];
      }

      return [
        {
          attendeeCCBID,
          attendeeName: attendee?.attendeeName ?? "",
        },
      ];
    },
  );

  const formattedDate = eventWithAttendance?.attendanceRecordDate;
  const defaultNotes = eventWithAttendance?.attendanceRecord?.notes ?? "";
  const defaultTopic = eventWithAttendance?.attendanceRecord?.topic ?? "";
  const normalizedNameFilter = normalizeNameSearchValue(nameFilter);
  let filteredAttendees = attendees;
  if (normalizedNameFilter) {
    const searchTerms = normalizedNameFilter.split(" ");

    filteredAttendees = attendees.filter((attendee) => {
      const normalizedAttendeeName = normalizeNameSearchValue(
        attendee.attendeeName,
      );

      return searchTerms.every((term) => normalizedAttendeeName.includes(term));
    });
  }

  const selectedIds$ = useObservable<string[]>(selectedAttendees);
  const selectedIds = useValue(selectedIds$);
  const selectedIdSet = new Set(selectedIds);

  const form = useZodForm({
    mode: "onChange",
    reValidateMode: "onChange",
    schema: Schema.Struct({
      notes: Schema.String.check(
        Schema.isMinLength(1, { message: "Required" }),
      ),
      topic: Schema.String.check(
        Schema.isMinLength(1, { message: "Required" }),
      ),
      attendees: Schema.Array(Schema.String).check(
        Schema.isMinLength(1, { message: "Required" }),
      ),
    }),
    defaultValues: {
      attendees: selectedAttendees,
      notes: defaultNotes,
      topic: defaultTopic,
    },
  });

  const defaultsKey = getEventCheckInDefaultsKey({
    attendeeIds: selectedAttendees,
    notes: defaultNotes,
    topic: defaultTopic,
  });
  usePristineCheckInDefaultsSync({
    defaultsKey,
    isDirty: form.formState.isDirty,
    sync: () => {
      selectedIds$.set(selectedAttendees);
      form.reset({
        attendees: selectedAttendees,
        notes: defaultNotes,
        topic: defaultTopic,
      });
    },
  });

  function syncSelectedAttendees(nextSelected: string[]) {
    form.setValue("attendees", getValidAttendeeIds(nextSelected), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function toggleAttendee(attendeeCCBID: string) {
    selectedIds$.set((current) => {
      const nextSelected = current.includes(attendeeCCBID)
        ? current.filter((selectedId) => selectedId !== attendeeCCBID)
        : [...current, attendeeCCBID];

      syncSelectedAttendees(nextSelected);
      return nextSelected;
    });
  }

  const allSelected =
    filteredAttendees.length > 0 &&
    filteredAttendees.every((attendee) =>
      selectedIdSet.has(attendee.attendeeCCBID),
    );

  function toggleAllAttendees() {
    const visibleAttendeeIds = filteredAttendees.map(
      (attendee) => attendee.attendeeCCBID,
    );
    const visibleAttendeeIdSet = new Set(visibleAttendeeIds);
    const nextSelected = allSelected
      ? selectedIds.filter(
          (selectedId) => !visibleAttendeeIdSet.has(selectedId),
        )
      : Array.from(new Set([...selectedIds, ...visibleAttendeeIds]));

    selectedIds$.set(nextSelected);
    syncSelectedAttendees(nextSelected);
  }

  const {
    formState: { isSubmitting, isValid, isDirty },
    handleSubmit,
  } = form;

  function renderItem({
    item,
    extraData,
  }: {
    item: AttendeeItem;
    extraData: Set<string>;
  }) {
    const checked = extraData.has(item.attendeeCCBID);

    return (
      <AttendeeRow
        attendeeId={item.attendeeCCBID}
        attendeeName={item.attendeeName}
        checked={checked}
        onToggle={toggleAttendee}
      />
    );
  }

  const submitDisabled =
    !isValid ||
    isSubmitting ||
    selectedIds.length === 0 ||
    isInFlight ||
    !isDirty;
  const listHeaderComponent = (
    <CheckInListHeader
      eventName={eventName}
      formattedDate={formattedDate}
      allSelected={allSelected}
      onToggleAll={toggleAllAttendees}
      nameFilter={nameFilter}
      onNameFilterChange={setNameFilter}
      attendeeCount={attendees.length}
      visibleCount={filteredAttendees.length}
      selectedCount={selectedIds.length}
    />
  );

  return (
    <DynamicKeyboardAvoidingView>
      <Form form={form}>
        <View className="flex-1">
          <LegendList
            recycleItems
            data={filteredAttendees}
            extraData={selectedIdSet}
            estimatedItemSize={ESTIMATED_ATTENDEE_ROW_SIZE}
            className="w-full flex-1"
            contentContainerClassName="px-5 pt-2 pb-6"
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={ItemSeparator}
            ListHeaderComponent={listHeaderComponent}
            ListEmptyComponent=<AttendanceEmptyState
              title={
                nameFilter.trim() ? "No matching attendees" : "No attendees yet"
              }
              message={
                nameFilter.trim()
                  ? "Try a different name or clear your search."
                  : "Attendees will appear here when they are added to this event."
              }
            />
            renderItem={renderItem}
            keyExtractor={(item, index) =>
              item.attendeeCCBID
                ? `attendee-${item.attendeeCCBID}`
                : `attendee-${index}`
            }
          />
          <AttendanceFooter
            disabled={submitDisabled}
            loading={isSubmitting || isInFlight}
            icon="check"
            label={
              isSubmitting || isInFlight
                ? "Saving attendance…"
                : "Save attendance"
            }
            summary={`${selectedIds.length} ${selectedIds.length === 1 ? "person" : "people"} marked present`}
            hint={
              !isValid
                ? "Add a topic, notes, and at least one attendee to save."
                : !isDirty
                  ? "Your saved attendance is up to date."
                  : "Your changes are ready to save."
            }
            onPress={handleSubmit(async (data) => {
              const attendeesIds = getValidAttendeeIds(data.attendees);

              try {
                await createEventAttendance({
                  attendeesIds,
                  eventId: ccbEventId,
                  notes: data.notes,
                  topic: data.topic,
                });
                toast.success({
                  title: "Attendance saved",
                });
                goBackOrReplace("/ministry-tools");
              } catch (error) {
                toast.error({
                  title: "Unable to save attendance",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Failed to submit check in",
                });
              }
            })}
          />
        </View>
      </Form>
    </DynamicKeyboardAvoidingView>
  );
}
