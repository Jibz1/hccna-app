import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { format, isValid, parseISO } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  contributionsLabel,
  hasNumericYear,
} from "@/components/giving/giving.utils";
import { GivingHistoryStatus } from "@/components/giving/GivingHistoryStatus";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import {
  StyledLinearGradient as LinearGradient,
  StyledLegendList as LegendList,
} from "@/cssInterop";
import { useExportYearGiving } from "@/hooks/giving/useExportMyYearlyGiving";
import {
  useGivingHistory,
  useUserProfile,
  type YearlyGiving,
} from "@/hooks/relay/useUserData";
import { useAppTheme } from "@/theme/useAppTheme";
import { AnimatedCounter } from "@/ui/AnimatedCounter";
import { Text } from "@/ui/Text";
import { formatCurrency } from "@/utils/formatAmount";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

type MonthlyGiving = NonNullable<YearlyGiving["groupGivingByMonth"]>[number];
type DonationItem = NonNullable<MonthlyGiving["givingList"]>[number];

function DonationRow({ item }: { item: DonationItem }) {
  const parsedDate = item.date ? parseISO(item.date) : null;
  const date = parsedDate && isValid(parsedDate) ? parsedDate : null;
  const metadata = [item.campus, item.paymentType].filter(Boolean).join(" · ");

  return (
    <View className="flex-row items-center gap-3 py-4">
      <View
        className="bg-design-selected min-h-12 w-12 items-center justify-center rounded-[14px] py-2"
        accessible
        accessibilityLabel={
          date ? format(date, "MMMM d, yyyy") : "Date unavailable"
        }
      >
        <Text variant="captionSm/medium" color="designAccent">
          {date ? format(date, "MMM").toUpperCase() : "—"}
        </Text>
        {date ? (
          <Text variant="bodyLg/bold" color="designPrimary">
            {format(date, "dd")}
          </Text>
        ) : null}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text variant="body/medium" color="designPrimary">
          {item.name ?? "Contribution"}
        </Text>
        {metadata ? (
          <Text variant="captionSm/regular" color="designMuted">
            {metadata}
          </Text>
        ) : null}
      </View>
      <Text
        variant="body/medium"
        color="designPrimary"
        className="shrink tabular-nums"
      >
        {formatCurrency(item.amount)}
      </Text>
    </View>
  );
}

function MonthSection({ item }: { item: MonthlyGiving }) {
  return (
    <View className="gap-3 pb-6">
      <View className="flex-row items-center justify-between gap-3 px-1">
        <Text
          accessibilityRole="header"
          variant="bodyLg/medium"
          color="designPrimary"
          transform="capitalize"
        >
          {item.month ?? "Other contributions"}
        </Text>
        <Text
          variant="body/medium"
          color="designMuted"
          className="tabular-nums"
        >
          {formatCurrency(item.total)}
        </Text>
      </View>
      <View className="border-continuous bg-design-surface border-design-border rounded-[24px] border px-4">
        {item.givingList?.map((donation, index) => (
          <View key={`${donation.transactionId}:${donation.date}:${index}`}>
            {index > 0 ? <View className="bg-design-border h-px" /> : null}
            <DonationRow item={donation} />
          </View>
        ))}
      </View>
    </View>
  );
}

function YearlyGivingSummary({ yearData }: { yearData: YearlyGiving }) {
  const { colors } = useAppTheme();
  const activeMonths =
    yearData.groupGivingByMonth?.filter((month) => month.givingList?.length)
      .length ?? 0;
  return (
    <View className="gap-7 pb-5">
      <View className="border-continuous border-design-border bg-design-surface gap-5 rounded-[28px] border p-6">
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="body/medium" color="designMuted">
            Total given in {yearData.year}
          </Text>
          <FontAwesome6 name="heart" size={20} color={colors.accent} />
        </View>
        <View className="gap-2">
          <AnimatedCounter
            variant="headingLg/bold"
            color="designPrimary"
            value={yearData.total ?? 0}
            formatValue={formatCurrency}
          />
          <Text variant="body/regular" color="designMuted">
            Thank you for your generosity.
          </Text>
        </View>
        <View className="border-design-border flex-row flex-wrap gap-x-6 gap-y-2 border-t pt-4">
          <View className="flex-row items-center gap-2">
            <FontAwesome6 name="heart" size={12} color={colors.textMuted} />
            <Text variant="caption/medium" color="designMuted">
              {contributionsLabel(yearData.numberOfGiving ?? 0)}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <FontAwesome6 name="calendar" size={12} color={colors.textMuted} />
            <Text variant="caption/medium" color="designMuted">
              {activeMonths} {activeMonths === 1 ? "month" : "months"} of giving
            </Text>
          </View>
        </View>
      </View>
      <View className="flex-row flex-wrap items-baseline justify-between gap-2 px-1">
        <Text
          accessibilityRole="header"
          variant="title/bold"
          color="designPrimary"
        >
          Giving activity
        </Text>
        <Text variant="caption/regular" color="designMuted">
          Most recent first
        </Text>
      </View>
    </View>
  );
}

function YearlyGivingDetails() {
  const { year } = useLocalSearchParams<{ year?: string | string[] }>();
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();
  const profile = useUserProfile();
  const history = useGivingHistory({ refresh: profile != null });
  const years = history.years
    .filter(hasNumericYear)
    .sort((a, b) => b.year - a.year);
  const yearParam = Array.isArray(year) ? year[0] : year;
  const safeYear =
    yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;
  const hasValidProfile = Boolean(profile?.ccbId && profile.ccbFamilyId);
  const yearData = hasValidProfile
    ? years.find((item) => item.year === safeYear)
    : undefined;
  const exportGiving = useExportYearGiving(yearData);
  const canExport =
    Boolean(yearData?.giving?.length) && !exportGiving.isPending;

  return (
    <View className="bg-design-background flex-1">
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <View
        style={{
          paddingTop: Platform.OS === "ios" ? 16 : Math.max(insets.top, 16),
          paddingLeft: insets.left + 20,
          paddingRight: insets.right + 20,
        }}
        className="gap-4 pb-4"
      >
        <View className="flex-row items-center gap-3">
          <View className="w-11" />
          <Text
            accessibilityRole="header"
            variant="bodyLg/bold"
            color="designPrimary"
            centered
            className="flex-1"
          >
            Giving details
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close giving details"
            onPress={() => {
              goBackOrReplace("/give");
            }}
            className="bg-design-text h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <FontAwesome6 name="xmark" size={18} color={colors.background} />
          </Pressable>
        </View>
        {hasValidProfile && years.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-5"
            contentContainerClassName="gap-2 px-5"
            contentInsetAdjustmentBehavior="never"
          >
            {years.map((item) => (
              <Pressable
                key={item.year}
                accessibilityRole="button"
                accessibilityLabel={`Show ${item.year} giving`}
                accessibilityState={{ selected: item.year === safeYear }}
                onPress={() => {
                  router.setParams({ year: String(item.year) });
                }}
                className={cn(
                  "min-h-11 min-w-19 items-center justify-center rounded-full border px-5 py-3 active:opacity-60",
                  item.year === safeYear
                    ? "bg-design-text border-design-text"
                    : "bg-design-surface border-design-border",
                )}
              >
                <Text
                  variant="body/medium"
                  color={
                    item.year === safeYear ? "designBackground" : "designMuted"
                  }
                >
                  {item.year}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      {hasValidProfile ? <GivingHistoryStatus history={history} /> : null}
      {yearData ? (
        <LegendList
          key={safeYear}
          recycleItems
          data={yearData.groupGivingByMonth ?? []}
          estimatedItemSize={230}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingLeft: insets.left + 20,
            paddingRight: insets.right + 20,
            paddingTop: 8,
            paddingBottom: 8,
          }}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
          keyExtractor={(item, index) => item.month ?? `month-${index}`}
          ListHeaderComponent=<YearlyGivingSummary yearData={yearData} />
          ListEmptyComponent={
            <Text
              variant="body/regular"
              color="designMuted"
              className="py-5"
              centered
            >
              No contributions recorded for {safeYear}.
            </Text>
          }
          renderItem={({ item }) => <MonthSection item={item} />}
        />
      ) : hasValidProfile && history.status !== "success" ? null : (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <FontAwesome6
            name="clock-rotate-left"
            size={28}
            color={colors.accent}
          />
          <Text variant="title/medium" color="designPrimary" centered>
            Giving details unavailable
          </Text>
          <Text variant="body/regular" color="designMuted" centered>
            Return to Giving to load your latest history.
          </Text>
        </View>
      )}
      {yearData ? (
        <View
          style={{
            paddingBottom: Math.max(insets.bottom, 16),
            paddingLeft: insets.left + 20,
            paddingRight: insets.right + 20,
          }}
          className="border-design-border bg-design-chrome gap-3 border-t pt-4"
        >
          {exportGiving.error ? (
            <Text
              accessibilityRole="alert"
              variant="caption/regular"
              color="designNegative"
            >
              {exportGiving.error.message ||
                "Unable to export your statement. Please try again."}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Export ${safeYear} giving statement`}
            accessibilityState={{
              disabled: !canExport,
              busy: exportGiving.isPending,
            }}
            disabled={!canExport}
            onPress={() => {
              exportGiving.mutate();
            }}
            className={cn(
              "border-continuous bg-design-text min-h-14 flex-row items-center justify-center gap-3 rounded-[20px] px-5 py-4 active:opacity-70",
              !canExport && "opacity-50",
            )}
          >
            {exportGiving.isPending ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <FontAwesome6
                name="file-arrow-down"
                size={17}
                color={colors.background}
              />
            )}
            <Text variant="bodyLg/medium" color="designBackground">
              {exportGiving.isPending
                ? "Preparing statement…"
                : "Export statement"}
            </Text>
          </Pressable>
          <Text variant="captionSm/regular" color="designMuted" centered>
            Download or share your {safeYear} giving records.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function YearlyGivingModalScreen() {
  return (
    <ErrorBoundaryWithRetry
      title="Unable to load giving details"
      subtitle="Please try again later"
    >
      <YearlyGivingDetails />
    </ErrorBoundaryWithRetry>
  );
}
