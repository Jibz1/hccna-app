import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { type ComponentProps, useEffect, useState } from "react";
import { AppState, Pressable, View } from "react-native";

import { useGivingHistory, useUserProfile } from "@/hooks/relay/useUserData";
import { useAppTheme } from "@/theme/useAppTheme";
import type { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { formatCurrency } from "@/utils/formatAmount";

import { AnimatedGivingAmount } from "./AnimatedGivingAmount";
import { contributionsLabel, hasNumericYear } from "./giving.utils";
import { GivingHistoryStatus } from "./GivingHistoryStatus";

export function MyGiving({
  currentYearOnly = false,
}: Pick<ComponentProps<typeof Card>, "variant"> & {
  currentYearOnly?: boolean;
}) {
  const { colors } = useAppTheme();
  const { navigate } = useRouter();
  const profile = useUserProfile();
  const history = useGivingHistory({ refresh: profile != null });
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [currentYear, setCurrentYear] = useState(() =>
    new Date().getFullYear(),
  );

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timeout);
      const now = new Date();
      setCurrentYear(now.getFullYear());
      // Local midnight handles year rollover without a months-long timer.
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      timeout = setTimeout(refresh, nextMidnight.getTime() - now.getTime());
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });
    return () => {
      clearTimeout(timeout);
      subscription.remove();
    };
  }, []);
  const years = history.years
    .filter(hasNumericYear)
    .sort((a, b) => b.year - a.year);
  const current = years.find((item) => item.year === currentYear);
  const previousYears = years.filter((item) => item.year !== currentYear);
  const hasDetails = Boolean(current?.groupGivingByMonth?.length);

  if (!profile?.ccbId || !profile.ccbFamilyId) {
    return null;
  }
  if (!years.length || (currentYearOnly && !current)) {
    return <GivingHistoryStatus history={history} />;
  }

  const openYear = (year: number) => {
    navigate({ pathname: "/yearly-giving-modal", params: { year } });
  };

  return (
    <View className="gap-3">
      <GivingHistoryStatus history={history} />
      <View className="border-continuous border-design-border bg-design-surface overflow-hidden rounded-[28px] border">
        <View className="gap-4 p-6">
          <View className="flex-row items-center justify-between gap-3">
            <Text variant="bodyLg/medium" color="designPrimary">
              Your giving
            </Text>
            <View className="bg-design-selected rounded-full px-3 py-1.5">
              <Text variant="caption/medium" color="designAccent">
                {currentYear}
              </Text>
            </View>
          </View>
          <View className="gap-1.5">
            <AnimatedGivingAmount
              variant="headingLg/bold"
              color="designPrimary"
              value={current?.total ?? 0}
            />
            <Text variant="caption/regular" color="designMuted">
              {contributionsLabel(current?.numberOfGiving ?? 0)} this year
            </Text>
          </View>
        </View>
        {hasDetails ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${currentYear} giving details`}
            onPress={() => {
              openYear(currentYear);
            }}
            className="border-design-border active:bg-design-selected min-h-14 flex-row items-center justify-between gap-3 border-t px-6 py-4"
          >
            <Text variant="body/medium" color="designAccent">
              View giving details
            </Text>
            <FontAwesome6 name="arrow-right" size={15} color={colors.accent} />
          </Pressable>
        ) : null}
      </View>
      {!currentYearOnly && previousYears.length > 0 ? (
        <View className="border-continuous border-design-border bg-design-surface overflow-hidden rounded-[22px] border">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Giving history"
            accessibilityState={{ expanded: historyExpanded }}
            onPress={() => {
              setHistoryExpanded((expanded) => !expanded);
            }}
            className="active:bg-design-selected min-h-14 flex-row items-center gap-3 px-5 py-4"
          >
            <FontAwesome6
              name="clock-rotate-left"
              size={17}
              color={colors.textMuted}
            />
            <Text
              className="flex-1"
              variant="body/medium"
              color="designPrimary"
            >
              Giving history
            </Text>
            <FontAwesome6
              name={historyExpanded ? "chevron-up" : "chevron-down"}
              size={12}
              color={colors.textMuted}
            />
          </Pressable>
          {historyExpanded
            ? previousYears.map((item) => (
                <Pressable
                  key={item.year}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${item.year} giving details, ${formatCurrency(item.total)}`}
                  accessibilityState={{
                    disabled: !item.groupGivingByMonth?.length,
                  }}
                  disabled={!item.groupGivingByMonth?.length}
                  onPress={() => {
                    openYear(item.year);
                  }}
                  className="border-design-border mx-5 flex-row items-center gap-3 border-t py-4 active:opacity-60"
                >
                  <View className="flex-1 gap-1">
                    <Text variant="body/medium" color="designPrimary">
                      {item.year}
                    </Text>
                    <Text variant="caption/regular" color="designMuted">
                      {contributionsLabel(item.numberOfGiving ?? 0)}
                    </Text>
                  </View>
                  <Text
                    variant="body/medium"
                    color="designPrimary"
                    className="tabular-nums"
                  >
                    {formatCurrency(item.total)}
                  </Text>
                  {item.groupGivingByMonth?.length ? (
                    <FontAwesome6
                      name="chevron-right"
                      size={11}
                      color={colors.textMuted}
                    />
                  ) : null}
                </Pressable>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}
