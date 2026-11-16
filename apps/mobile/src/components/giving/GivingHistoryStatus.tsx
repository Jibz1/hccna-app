import { Match } from "effect";
import { ActivityIndicator, Pressable, View } from "react-native";

import type { useGivingHistory } from "@/hooks/relay/useUserData";
import { Text } from "@/ui/Text";

type Props = { history: ReturnType<typeof useGivingHistory> };

export function GivingHistoryStatus({ history }: Props) {
  if (history.status === "success" && !history.isRefreshing) {
    return null;
  }
  const loading = history.isRefreshing || history.status === "loading";
  const message = Match.value({
    loading,
    status: history.status,
    hasSavedHistory: history.years.length > 0,
  }).pipe(
    Match.when({ loading: true }, () => "Loading your giving history…"),
    Match.when({ status: "empty" }, () => "No contributions recorded yet."),
    Match.when(
      { hasSavedHistory: true },
      () => "Unable to refresh giving. Showing your saved history.",
    ),
    Match.orElse(() => "Unable to load your giving history. Please try again."),
  );
  return (
    <View className="bg-design-surface border-design-border gap-3 rounded-2xl border p-5">
      <Text
        accessibilityRole={history.status === "error" ? "alert" : undefined}
        variant="body/regular"
        color="designMuted"
      >
        {message}
      </Text>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading giving history" />
      ) : null}
      {history.status === "error" && !loading ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry giving history"
          onPress={history.retry}
          className="active:bg-design-selected min-h-11 justify-center rounded-xl px-3"
        >
          <Text variant="body/medium" color="designAccent">
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
