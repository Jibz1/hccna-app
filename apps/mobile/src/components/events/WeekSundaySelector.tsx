import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {
  addMonths,
  eachWeekOfInterval,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfMonth,
} from "date-fns";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

import { getSundayStartOfWeek } from "./WeekSundaySelector.utils";

type WeekSundaySelectorProps = {
  disabled?: boolean;
  helperText?: string;
  maxWeek?: Date;
  minWeek?: Date;
  title?: string;
  value: Date;
  onChange: (date: Date) => void;
};

function getSundaysForMonth(date: Date) {
  return eachWeekOfInterval(
    {
      start: startOfMonth(date),
      end: endOfMonth(date),
    },
    {
      weekStartsOn: 0,
    },
  ).filter((weekStart) => isSameMonth(weekStart, date));
}

function isWeekDisabled(date: Date, minWeek?: Date, maxWeek?: Date) {
  if (minWeek && isBefore(date, minWeek)) {
    return true;
  }

  if (maxWeek && isAfter(date, maxWeek)) {
    return true;
  }

  return false;
}

export function WeekSundaySelector({
  disabled = false,
  helperText = "Attendance is grouped by the Sunday starting each week.",
  maxWeek,
  minWeek,
  title = "Attendance week",
  value,
  onChange,
}: WeekSundaySelectorProps) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const normalizedMinWeek = minWeek ? getSundayStartOfWeek(minWeek) : undefined;
  const normalizedMaxWeek = maxWeek ? getSundayStartOfWeek(maxWeek) : undefined;
  const minVisibleMonth = normalizedMinWeek
    ? startOfMonth(normalizedMinWeek)
    : undefined;
  const maxVisibleMonth = normalizedMaxWeek
    ? startOfMonth(normalizedMaxWeek)
    : undefined;
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(value));

  const formattedDisplayDate = format(value, "EEEE, MMMM d, yyyy");
  const visibleMonthLabel = format(visibleMonth, "MMMM yyyy");
  const visibleMonthSundays = getSundaysForMonth(visibleMonth);
  const canShowPreviousMonth = minVisibleMonth
    ? isAfter(visibleMonth, minVisibleMonth)
    : true;
  const canShowNextMonth = maxVisibleMonth
    ? isBefore(visibleMonth, maxVisibleMonth)
    : true;

  function showPreviousMonth() {
    if (!canShowPreviousMonth) {
      return;
    }
    setVisibleMonth((current) => startOfMonth(addMonths(current, -1)));
  }

  function showNextMonth() {
    if (!canShowNextMonth) {
      return;
    }
    setVisibleMonth((current) => startOfMonth(addMonths(current, 1)));
  }

  function selectSunday(date: Date) {
    if (isWeekDisabled(date, normalizedMinWeek, normalizedMaxWeek)) {
      return;
    }

    onChange(date);
    setExpanded(false);
  }

  return (
    <View className="border-continuous bg-design-surface border-design-border gap-3 rounded-[24px] border p-4">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${formattedDisplayDate}`}
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={() => {
          if (!expanded) {
            setVisibleMonth(startOfMonth(value));
          }
          setExpanded((current) => !current);
        }}
        className="min-h-14 flex-row items-center gap-3 active:opacity-60"
      >
        <View className="bg-design-selected h-11 w-11 items-center justify-center rounded-[14px]">
          <FontAwesome6 name="calendar-days" size={19} color={colors.accent} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text variant="caption/regular" color="designMuted">
            {title}
          </Text>
          <Text variant="body/medium" color="designPrimary">
            {format(value, "MMM d, yyyy")}
          </Text>
        </View>
        <FontAwesome6
          name={expanded ? "chevron-up" : "chevron-down"}
          size={13}
          color={colors.textMuted}
        />
      </Pressable>
      {expanded ? (
        <View className="border-design-border gap-4 border-t pt-3">
          <View className="flex-row items-center justify-between gap-2">
            <Pressable
              onPress={showPreviousMonth}
              disabled={disabled || !canShowPreviousMonth}
              accessibilityRole="button"
              accessibilityState={{
                disabled: disabled || !canShowPreviousMonth,
              }}
              accessibilityLabel="Show previous month"
              className={cn(
                "bg-design-selected h-11 w-11 items-center justify-center rounded-full active:opacity-60",
                !canShowPreviousMonth && "opacity-30",
              )}
            >
              <FontAwesome6 name="chevron-left" size={13} color={colors.text} />
            </Pressable>
            <Text variant="body/medium" color="designPrimary">
              {visibleMonthLabel}
            </Text>
            <Pressable
              onPress={showNextMonth}
              disabled={disabled || !canShowNextMonth}
              accessibilityRole="button"
              accessibilityState={{ disabled: disabled || !canShowNextMonth }}
              accessibilityLabel="Show next month"
              className={cn(
                "bg-design-selected h-11 w-11 items-center justify-center rounded-full active:opacity-60",
                !canShowNextMonth && "opacity-30",
              )}
            >
              <FontAwesome6
                name="chevron-right"
                size={13}
                color={colors.text}
              />
            </Pressable>
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Week starting Sunday"
            className="flex-row gap-1.5"
          >
            {visibleMonthSundays.map((sunday) => {
              const selected = isSameDay(sunday, value);
              const weekDisabled =
                disabled ||
                isWeekDisabled(sunday, normalizedMinWeek, normalizedMaxWeek);
              return (
                <Pressable
                  key={format(sunday, "yyyy-MM-dd")}
                  onPress={() => {
                    selectSunday(sunday);
                  }}
                  disabled={weekDisabled}
                  accessibilityLabel={format(sunday, "EEEE, MMMM d, yyyy")}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: selected,
                    disabled: weekDisabled,
                  }}
                  className={cn(
                    "min-h-17 flex-1 items-center justify-center gap-1 rounded-[14px] border py-3 active:opacity-60",
                    selected
                      ? "bg-design-text border-design-text"
                      : "bg-design-surface-strong border-design-border",
                    weekDisabled && "opacity-30",
                  )}
                >
                  <Text
                    variant="captionSm/regular"
                    color={selected ? "designBackground" : "designMuted"}
                  >
                    Sun
                  </Text>
                  <Text
                    variant="bodyLg/bold"
                    color={selected ? "designBackground" : "designPrimary"}
                  >
                    {format(sunday, "d")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text variant="captionSm/regular" color="designMuted">
            {helperText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
