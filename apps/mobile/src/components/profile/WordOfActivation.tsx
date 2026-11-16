import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { useWordOfActivation } from "@/hooks/relay/useUserData";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export function WordOfActivation({ className }: { className?: string }) {
  const { navigate } = useRouter();
  const { colors } = useAppTheme();
  const verse = useWordOfActivation();
  if (!verse?.month) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Read your Word of Activation for ${verse.month}`}
      onPress={() => {
        navigate("/vod-detail-modal?slug=word-of-activation");
      }}
      className={cn(
        "border-continuous border-design-border bg-design-surface gap-4 rounded-[28px] border p-6 active:opacity-70",
        className,
      )}
    >
      <View className="flex-row items-center gap-3">
        <FontAwesome6 name="book-open" size={17} color={colors.accent} />
        <Text className="flex-1" variant="caption/medium" color="designAccent">
          Word of Activation · {verse.month}
        </Text>
      </View>
      <Text variant="title/medium" color="designPrimary">
        {verse.book}
      </Text>
      <Text variant="body/regular" color="designMuted" numberOfLines={4}>
        {verse.text}
      </Text>
      <View className="flex-row items-center gap-2">
        <Text variant="caption/medium" color="designAccent">
          Read your word
        </Text>
        <FontAwesome6 name="arrow-right" size={12} color={colors.accent} />
      </View>
    </Pressable>
  );
}
