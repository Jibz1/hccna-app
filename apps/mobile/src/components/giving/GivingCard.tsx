import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Pressable, View } from "react-native";

import { StyledImage as Image } from "@/cssInterop";
import { useClipboard } from "@/hooks/utils/useClipboard";
import { useAppTheme } from "@/theme/useAppTheme";
import { Link } from "@/ui/Link";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { successHaptic } from "@/utils/haptics";

// These CMS SVGs wrap PNGs in <pattern>/<use>, which the native image
// decoder renders blank. Bundle raster copies of the same artwork.
const givingIconAssets = {
  Givelify: require("../../../assets/images/giving/givelify.png"),
  Zelle: require("../../../assets/images/giving/zelle.png"),
};

export function GivingCard({
  title,
  icon,
  link,
  text,
}: {
  title: string;
  icon: string;
  link: string;
  text?: string;
}) {
  const { colors } = useAppTheme();
  const { copy } = useClipboard();
  const iconSource = Object.hasOwn(givingIconAssets, title)
    ? givingIconAssets[title as keyof typeof givingIconAssets]
    : icon;
  const copyText = text?.trim() ? text : undefined;
  const available = Boolean(copyText) || Boolean(link);
  const content = (
    <View className="border-continuous border-design-border bg-design-surface-strong min-h-20 flex-row items-center gap-3.5 rounded-[20px] border p-4">
      <View className="bg-design-selected h-11 w-11 items-center justify-center rounded-[14px] dark:bg-white">
        {iconSource ? (
          <Image
            source={iconSource}
            accessible={false}
            cachePolicy="disk"
            contentFit="contain"
            className="h-7 w-7"
          />
        ) : (
          <FontAwesome6 name="globe" size={21} color="#995234" />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text variant="bodyLg/medium" color="designPrimary">
          {title}
        </Text>
        <Text variant="caption/regular" color="designMuted">
          {copyText ?? (link ? "Give online" : "Currently unavailable")}
        </Text>
        {text ? (
          <Text variant="captionSm/medium" color="designAccent">
            Tap to copy
          </Text>
        ) : null}
      </View>
      {available ? (
        <FontAwesome6
          name={text ? "copy" : "arrow-up-right-from-square"}
          size={15}
          color={colors.accent}
        />
      ) : null}
    </View>
  );

  if (text) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy ${title} details: ${text}`}
        onPress={async () => {
          try {
            await copy(text);
            toast.success({ title: `${title} details copied` });
            successHaptic()?.catch(() => undefined);
          } catch {
            toast.error({ title: "Failed to copy" });
          }
        }}
        className="active:opacity-60"
      >
        {content}
      </Pressable>
    );
  }

  if (!link) {
    return content;
  }

  return (
    <Link
      href={link}
      openWithSystemBrowser={
        title.toLowerCase().replace(/\s/g, "") === "cashapp"
      }
      accessibilityLabel={`Give with ${title}`}
      accessibilityHint="Opens the giving provider"
      className="active:opacity-60"
    >
      {content}
    </Link>
  );
}
