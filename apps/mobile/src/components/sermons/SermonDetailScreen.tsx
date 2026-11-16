import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import YoutubePlayer from "react-native-youtube-iframe";

import {
  StyledImage as Image,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useAppTheme } from "@/theme/useAppTheme";
import { Link } from "@/ui/Link";
import { Text } from "@/ui/Text";
import { getIdFromUrl } from "@/utils/getIdFromUrl";
import { goBackOrReplace } from "@/utils/navigation";

function SermonVideo({
  videoId,
  image,
  title,
}: {
  videoId?: string;
  image?: string;
  title: string;
}) {
  const { colors } = useAppTheme();
  const isFocused = useIsFocused();
  const { width, onLayout } = useContainerWidth();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [isPlaying, setIsPlaying] = useState(false);
  const height = width * (9 / 16);
  const isMounted = state === "loading" || state === "ready";

  useEffect(() => {
    if (state !== "loading") {
      return;
    }
    const timer = setTimeout(() => {
      setState("error");
    }, 20_000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  return (
    <View
      onLayout={onLayout}
      testID="sermon-video-frame"
      className="border-continuous bg-design-selected aspect-video w-full overflow-hidden rounded-[24px]"
    >
      {videoId && isMounted && width > 0 ? (
        <YoutubePlayer
          videoId={videoId}
          width={width}
          height={height}
          play={isFocused && isPlaying}
          onChangeState={(nextState: string) => {
            if (nextState === "playing") {
              setIsPlaying(true);
            } else if (nextState === "paused" || nextState === "ended") {
              setIsPlaying(false);
            }
          }}
          onReady={() => {
            setState("ready");
          }}
          onError={() => {
            setState("error");
          }}
          webViewProps={{
            onError: () => {
              setState("error");
            },
            onHttpError: () => {
              setState("error");
            },
          }}
        />
      ) : null}
      {!videoId || state === "error" ? (
        <View className="absolute inset-0 items-center justify-center gap-3 px-6">
          <FontAwesome6 name="circle-play" size={30} color={colors.accent} />
          <Text variant="bodyLg/medium" color="designPrimary" centered>
            {videoId ? "Unable to play this video" : "Video unavailable"}
          </Text>
          {videoId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry video"
              onPress={() => {
                setIsPlaying(false);
                setState("loading");
              }}
              className="bg-design-text min-h-11 items-center justify-center rounded-full px-5 py-2.5 active:opacity-70"
            >
              <Text variant="body/medium" color="designBackground">
                Try again
              </Text>
            </Pressable>
          ) : (
            <Text variant="caption/regular" color="designMuted" centered>
              Check back later for this message.
            </Text>
          )}
        </View>
      ) : state === "loading" ? (
        <View className="absolute inset-0" pointerEvents="none">
          {image ? (
            <Image
              source={image}
              contentFit="cover"
              cachePolicy="disk"
              enforceEarlyResizing
              accessible={false}
              className="absolute inset-0 h-full w-full"
            />
          ) : null}
          <View className="absolute inset-0 bg-black/25" />
          <View
            accessibilityLabel={`Loading ${title}`}
            accessibilityRole="progressbar"
            className="h-full items-center justify-center gap-3"
          >
            <ActivityIndicator color={colors.onImage} size="large" />
            <Text variant="body/medium" color="onImage">
              Loading video…
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function SermonDetailScreen({
  link,
  title,
  body,
  image,
  kind,
  speaker,
  speakerImage,
}: {
  link?: string;
  title?: string;
  body?: string;
  image?: string;
  kind?: string;
  speaker?: string;
  speakerImage?: string;
}) {
  const insets = useSafeAreaInsets();
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const displayTitle = title?.trim() ? title.trim() : "Message";
  const displaySpeaker = speaker?.trim();
  const description = body?.trim();
  const candidateId = getIdFromUrl(link ?? "") ?? link;
  const videoId =
    candidateId && /^[\w-]{11}$/.test(candidateId) ? candidateId : undefined;
  const youtubeUrl = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : undefined;
  const share = async () => {
    if (!youtubeUrl) {
      return;
    }
    try {
      await Share.share({
        title: displayTitle,
        message: [displayTitle, displaySpeaker, youtubeUrl]
          .filter(Boolean)
          .join("\n\n"),
      });
    } catch {
      Alert.alert("Unable to share", "Please try again.");
    }
  };

  return (
    <View
      className="bg-design-background flex-1"
      style={{ paddingLeft: insets.left, paddingRight: insets.right }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <View className="w-full max-w-170 flex-1 self-center">
        <View
          className="flex-row items-center justify-between gap-3 px-5 pb-4"
          style={{
            paddingTop: Platform.OS === "ios" ? 12 : Math.max(insets.top, 12),
          }}
        >
          <Text variant="bodyLg/medium" color="designPrimary">
            {kind === "sermon" ? "Sermon" : "Message"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close video details"
            onPress={() => {
              goBackOrReplace(kind === "sermon" ? "/(tabs)/sermons" : "/");
            }}
            className="border-design-border bg-design-surface active:bg-design-selected h-11 w-11 items-center justify-center rounded-full border"
          >
            <FontAwesome6 name="xmark" size={18} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }}
        >
          <View className="gap-6 px-5">
            <SermonVideo
              key={videoId}
              videoId={videoId}
              image={image}
              title={displayTitle}
            />
            <View className="gap-3">
              <Text
                variant="caption/medium"
                color="designAccent"
                transform="uppercase"
                className="tracking-[1.5px]"
              >
                {kind === "sermon" ? "Sermon" : "Watch & reflect"}
              </Text>
              <Text
                accessibilityRole="header"
                selectable
                variant="heading/bold"
                color="designPrimary"
                className="tracking-[-0.8px]"
              >
                {displayTitle}
              </Text>
            </View>
            {displaySpeaker ? (
              <View className="border-continuous border-design-border bg-design-surface flex-row items-center gap-3.5 rounded-[24px] border p-4">
                {speakerImage ? (
                  <Image
                    source={speakerImage}
                    accessible={false}
                    contentFit="cover"
                    contentPosition="top"
                    cachePolicy="disk"
                    enforceEarlyResizing
                    className="bg-design-selected h-14 w-14 rounded-2xl"
                  />
                ) : (
                  <View className="bg-design-selected h-14 w-14 items-center justify-center rounded-2xl">
                    <FontAwesome6 name="user" size={21} color={colors.accent} />
                  </View>
                )}
                <View className="flex-1 gap-1">
                  <Text variant="caption/regular" color="designMuted">
                    Speaker
                  </Text>
                  <Text
                    selectable
                    variant="bodyLg/medium"
                    color="designPrimary"
                  >
                    {displaySpeaker}
                  </Text>
                </View>
              </View>
            ) : null}
            {description && description !== displaySpeaker ? (
              <Text selectable variant="bodyLg/regular" color="designMuted">
                {description}
              </Text>
            ) : null}
            {youtubeUrl ? (
              <View className="gap-3">
                <Link
                  href={youtubeUrl}
                  openWithSystemBrowser
                  accessibilityLabel="Open in YouTube"
                  className="border-continuous bg-design-text min-h-14 flex-row items-center justify-center gap-3 rounded-[20px] px-5 py-4 active:opacity-70"
                >
                  <FontAwesome6
                    name="youtube"
                    size={22}
                    color={colors.background}
                  />
                  <Text variant="bodyLg/medium" color="designBackground">
                    Open in YouTube
                  </Text>
                  <FontAwesome6
                    name="arrow-up-right-from-square"
                    size={14}
                    color={colors.background}
                  />
                </Link>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Share message"
                  onPress={share}
                  className="border-continuous border-design-border bg-design-surface active:bg-design-selected min-h-14 flex-row items-center justify-center gap-3 rounded-[20px] border px-5 py-4"
                >
                  <FontAwesome6
                    name="arrow-up-from-bracket"
                    size={18}
                    color={colors.accent}
                  />
                  <Text variant="bodyLg/medium" color="designPrimary">
                    Share message
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
