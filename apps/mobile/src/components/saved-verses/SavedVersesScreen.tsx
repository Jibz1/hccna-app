import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { Alert, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  StyledLegendList as LegendList,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

import { useSavedVerseActions } from "./useSavedVerseActions";
import { useSavedVerses, type SavedVerseItem } from "./useSavedVerses";

const savedDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function savedDateLabel(savedAt: string) {
  const timestamp = Date.parse(savedAt);
  return Number.isFinite(timestamp)
    ? `Saved ${savedDateFormatter.format(timestamp)}`
    : "Save date unavailable";
}

function verseKey(verse: SavedVerseItem) {
  return verse.verseId;
}

export function SavedVersesScreen() {
  const { navigate } = useRouter();
  const { isSignedIn, isLoaded, failed, retry, verses } = useSavedVerses();
  const { remove } = useSavedVerseActions();
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, onLayout } = useContainerWidth();
  const { fontScale } = useWindowDimensions();
  const twoColumns =
    width - insets.left - insets.right >= 768 && fontScale < 1.5;

  const openVerse = (verse: SavedVerseItem) => {
    navigate({
      pathname: "/vod-detail-modal",
      params: { savedVerseId: verse.verseId },
    });
  };

  const removeVerse = (verse: SavedVerseItem) => {
    remove(verse.verseId).catch((error: Error) => {
      Alert.alert("Unable to remove verse", error.message);
    });
  };

  return (
    <View
      testID="saved-verses-screen"
      onLayout={onLayout}
      className="bg-design-background flex-1"
    >
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <View
        style={{ paddingLeft: insets.left, paddingRight: insets.right }}
        className={cn(
          "w-full flex-1 self-center",
          twoColumns ? "max-w-256" : "max-w-135",
        )}
      >
        <View
          style={{ paddingTop: insets.top + 12 }}
          className="flex-row items-center gap-3 px-[22px] pb-5"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back from saved verses"
            onPress={() => {
              goBackOrReplace("/more");
            }}
            className="bg-design-surface h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <FontAwesome6 name="chevron-left" size={18} color={colors.text} />
          </Pressable>
          <Text
            accessibilityRole="header"
            className="flex-1"
            color="designPrimary"
            variant="bodyLg/bold"
            centered
          >
            Saved verses
          </Text>
          <View className="w-11" />
        </View>
        <LegendList
          numColumns={twoColumns ? 2 : 1}
          data={verses}
          keyExtractor={verseKey}
          contentContainerStyle={{
            paddingLeft: 22,
            paddingRight: 22,
            paddingBottom: insets.bottom + 32,
          }}
          ListHeaderComponent={
            <View className="gap-2 pb-6">
              <Text color="designMuted" variant="caption/regular">
                Keep the words you want to return to. Saved to your account,
                ready to read offline.
              </Text>
              {verses.length > 0 ? (
                <Text color="designAccent" variant="caption/medium">
                  {verses.length} {verses.length === 1 ? "verse" : "verses"}
                  {" · Newest first"}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            !isSignedIn ? (
              <SavedVersesNotice
                title="Sign in to keep saved verses"
                body="Saved verses belong to your account, so they stay with you on every device."
                action="Sign in"
                onPress={() => {
                  navigate("/account-modal-stack");
                }}
              />
            ) : failed ? (
              <SavedVersesNotice
                title="Saved verses didn’t load"
                body="Check your connection, then try again."
                action="Try again"
                onPress={retry}
              />
            ) : !isLoaded ? (
              <Text variant="body/regular" color="designMuted" centered>
                Loading saved verses…
              </Text>
            ) : (
              <View className="border-design-border bg-design-surface w-full max-w-135 items-center gap-4 self-center rounded-[26px] border px-6 py-10">
                <View className="bg-design-selected h-16 w-16 items-center justify-center rounded-full">
                  <FontAwesome6
                    name="bookmark"
                    size={25}
                    color={colors.accent}
                  />
                </View>
                <Text variant="title/medium" color="designPrimary" centered>
                  Your collection starts here
                </Text>
                <Text variant="body/regular" color="designMuted" centered>
                  Tap Save on a Verse of the Day or Word of Activation. Each
                  scripture you save will appear here.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    navigate("/vod-detail-modal");
                  }}
                  className="bg-design-selected mt-2 min-h-[48px] items-center justify-center rounded-full px-6 py-3 active:opacity-60"
                >
                  <Text variant="body/medium" color="designAccent">
                    Read today’s verse
                  </Text>
                </Pressable>
              </View>
            )
          }
          renderItem={({ item, index }) => (
            <View
              className={cn(
                "mb-3",
                twoColumns && (index % 2 === 0 ? "pr-3" : "pl-3"),
              )}
            >
              <View className="border-design-border bg-design-surface overflow-hidden rounded-[24px] border">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Read saved verse, ${item.book}`}
                  accessibilityHint="Opens the full scripture, with sharing and removal options"
                  onPress={() => {
                    openVerse(item);
                  }}
                  className="active:bg-design-selected gap-3 p-5"
                >
                  <View className="flex-row items-center gap-3">
                    <FontAwesome6
                      name="bookmark"
                      solid
                      size={14}
                      color={colors.accent}
                    />
                    <Text
                      className="flex-1"
                      variant="caption/medium"
                      color="designMuted"
                    >
                      {item.kind === "WORD_OF_ACTIVATION"
                        ? "Word of Activation"
                        : "Verse of the Day"}
                    </Text>
                    <FontAwesome6
                      name="chevron-right"
                      size={12}
                      color={colors.textMuted}
                    />
                  </View>
                  <Text
                    variant="bodyLg/medium"
                    color="designPrimary"
                    className="leading-[27px]"
                    numberOfLines={4}
                  >
                    {item.text}
                  </Text>
                  <Text variant="caption/medium" color="designAccent">
                    {item.book}
                  </Text>
                </Pressable>
                <View className="border-design-border flex-row items-center gap-2 border-t px-5 py-1">
                  <Text
                    className="flex-1"
                    variant="caption/regular"
                    color="designMuted"
                  >
                    {savedDateLabel(String(item.savedAt))}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove saved verse, ${item.book}`}
                    onPress={() => {
                      removeVerse(item);
                    }}
                    className="active:bg-design-selected min-h-11 flex-row items-center justify-center gap-2 rounded-xl px-2"
                  >
                    <FontAwesome6
                      name="trash-can"
                      size={13}
                      color={colors.accent}
                    />
                    <Text variant="caption/medium" color="designAccent">
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      </View>
    </View>
  );
}

function SavedVersesNotice({
  title,
  body,
  action,
  onPress,
}: {
  title: string;
  body: string;
  action: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View className="border-design-border bg-design-surface w-full max-w-135 items-center gap-4 self-center rounded-[26px] border px-6 py-10">
      <View className="bg-design-selected h-16 w-16 items-center justify-center rounded-full">
        <FontAwesome6 name="bookmark" size={25} color={colors.accent} />
      </View>
      <Text variant="title/medium" color="designPrimary" centered>
        {title}
      </Text>
      <Text variant="body/regular" color="designMuted" centered>
        {body}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className="bg-design-selected mt-2 min-h-[48px] items-center justify-center rounded-full px-6 py-3 active:opacity-60"
      >
        <Text variant="body/medium" color="designAccent">
          {action}
        </Text>
      </Pressable>
    </View>
  );
}
