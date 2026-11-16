import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { useContainerWidth } from "@/hooks/useContainerWidth";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

import { EventEmptyState } from "./EventLayout";
import { EventLink, type EventLinkProps } from "./EventLinks";

export interface EventMonthSection {
  key: string;
  title: string;
  year: number;
  events: readonly (EventLinkProps & { startDate: string })[];
}

const monthControlsStyle = { paddingHorizontal: 20, gap: 8 };

export function EventAgenda({
  months,
}: {
  months: readonly EventMonthSection[];
}) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const { width, onLayout } = useContainerWidth();
  const { fontScale } = useWindowDimensions();
  const twoColumns = width >= 768 && fontScale < 1.5;
  // A refresh can remove a month. Keep the remaining schedule visible.
  const activeMonth = months.find((month) => month.key === selectedMonth);
  const visibleMonths = activeMonth ? [activeMonth] : months;
  const eventCount = visibleMonths.reduce(
    (count, month) => count + month.events.length,
    0,
  );
  const filters = [
    {
      key: null,
      label: "All dates",
      accessibilityLabel: "All upcoming events",
    },
    ...months.map((month) => ({
      key: month.key,
      label: `${month.title.slice(0, 3)} ${month.year}`,
      accessibilityLabel: `${month.title} ${month.year} events`,
    })),
  ];

  if (months.length === 0) {
    return (
      <View className="px-5">
        <EventEmptyState
          title="No upcoming events"
          message="Check back soon for the latest event dates."
        />
      </View>
    );
  }

  return (
    <View onLayout={onLayout} testID="event-agenda" className="gap-5">
      <View className="gap-4">
        <View className="flex-row items-center justify-between gap-3 px-5">
          <Text
            accessibilityRole="header"
            variant="titleLg/medium"
            color="designPrimary"
          >
            Upcoming
          </Text>
          <View className="bg-design-selected rounded-full px-3 py-1.5">
            <Text
              accessibilityLiveRegion="polite"
              variant="caption/medium"
              color="designAccent"
            >
              {eventCount} {eventCount === 1 ? "event" : "events"}
            </Text>
          </View>
        </View>
        {months.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={monthControlsStyle}
          >
            {filters.map((filter) => {
              const selected = filter.key === (activeMonth?.key ?? null);
              return (
                <Pressable
                  key={filter.key ?? "all"}
                  accessibilityRole="tab"
                  accessibilityLabel={filter.accessibilityLabel}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setSelectedMonth(filter.key);
                  }}
                  className={cn(
                    "border-continuous min-h-11 items-center justify-center rounded-2xl border px-4 py-2.5 active:opacity-70",
                    selected
                      ? "border-design-text bg-design-text"
                      : "border-design-border bg-design-surface",
                  )}
                >
                  <Text
                    variant="caption/medium"
                    color={selected ? "designBackground" : "designMuted"}
                  >
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
      <View className="gap-6 px-5">
        {visibleMonths.map((month) => (
          <View key={month.key} className="gap-3">
            <View className="flex-row items-center gap-3">
              <Text
                accessibilityRole="header"
                variant="caption/medium"
                color="designAccent"
                transform="uppercase"
                className="tracking-[1.5px]"
              >
                {month.title} {month.year}
              </Text>
              <View className="bg-design-border h-px flex-1" />
            </View>
            <View className="flex-row flex-wrap gap-3">
              {month.events.map((event) => (
                <View
                  key={`${event.slug}-${event.startDate}`}
                  style={{ width: twoColumns ? (width - 40 - 12) / 2 : "100%" }}
                >
                  <Card variant="transparent" className="bg-design-surface">
                    <EventLink {...event} />
                  </Card>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
