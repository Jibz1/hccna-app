import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { StyledImage as Image } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

import { getSermonRoute, type SermonNavigationData } from "./sermon.utils";

export function SermonRow(sermon: SermonNavigationData) {
  const { navigate } = useRouter();
  const { colors } = useAppTheme();
  const { title, thumbnail, speakerFullName } = sermon;
  const displayTitle = title?.trim() ? title.trim() : "Sermon";
  const speaker = speakerFullName?.trim();

  return (
    <View className="w-full max-w-170 self-center px-5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${displayTitle}${speaker ? ` by ${speaker}` : ""}`}
        onPress={() => {
          navigate(getSermonRoute(sermon));
        }}
        className="gap-4xs flex-row items-center py-1 active:opacity-70"
      >
        <View className="border-continuous bg-design-selected h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[14px]">
          {thumbnail ? (
            <Image
              source={thumbnail}
              accessible={false}
              contentFit="cover"
              contentPosition="center"
              placeholderContentFit="cover"
              cachePolicy="disk"
              enforceEarlyResizing
              recyclingKey={thumbnail}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <FontAwesome6 name="book-bible" size={22} color={colors.accent} />
          )}
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text
            variant="bodyLg/regular"
            color="designPrimary"
            numberOfLines={2}
          >
            {displayTitle}
          </Text>
          {speaker ? (
            <Text variant="body/regular" color="designMuted" numberOfLines={1}>
              {speaker}
            </Text>
          ) : null}
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="border-design-accent h-9 w-9 shrink-0 items-center justify-center rounded-full border-2"
        >
          <FontAwesome6
            name="play"
            size={12}
            color={colors.accent}
            style={{ marginLeft: 2 }}
          />
        </View>
      </Pressable>
    </View>
  );
}
