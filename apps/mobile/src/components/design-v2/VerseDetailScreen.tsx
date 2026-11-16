import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { SaveVerseButton } from "@/components/saved-verses/SaveVerseButton";
import {
  StyledImage as Image,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { connectivity } from "@/effect/connectivity";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { type SavedVerse } from "@/utils/savedVerses";
import { cn } from "@/utils/styling";

export type VerseDetailData = {
  /** Scripture catalog ID; verses without one cannot be saved. */
  readonly verseId?: string | null;
  readonly book?: string | null;
  readonly text?: string | null;
  readonly image?: string | null;
};

function SunMark() {
  return (
    <Svg width={52} height={52} viewBox="0 0 52 52" aria-hidden>
      <Path
        d="M26 0 28.7 17.5 39 3.5 33.4 20.6 48.5 13 36.2 25 52 26 34.5 28.7 48.5 39 31.4 33.4 39 48.5 27 36.2 26 52 23.3 34.5 13 48.5 18.6 31.4 3.5 39 15.8 27 0 26 17.5 23.3 3.5 13 20.6 18.6 13 3.5 25 15.8Z"
        fill="#FFF8E9"
      />
    </Svg>
  );
}

function VerseFrame({
  image,
  children,
  onShare,
}: {
  image?: string | null;
  children: ReactNode;
  onShare?: () => void;
}) {
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { back, canGoBack, replace } = useRouter();
  const close = () => {
    if (canGoBack()) {
      back();
    } else {
      replace("/");
    }
  };
  return (
    <View className="bg-verse-background flex-1">
      {image ? (
        <Image
          source={image}
          contentFit="cover"
          contentPosition="center"
          blurRadius={18}
          cachePolicy="disk"
          enforceEarlyResizing
          recyclingKey={image}
          accessible={false}
          className="absolute inset-0"
        />
      ) : null}
      <LinearGradient
        colors={
          isDark
            ? [
                "rgba(10, 14, 12, 0.48)",
                "rgba(10, 14, 12, 0.4)",
                "rgba(13, 16, 11, 0.8)",
                "rgba(13, 16, 11, 0.94)",
              ]
            : [
                "rgba(10, 14, 12, 0.42)",
                "rgba(10, 14, 12, 0.28)",
                "rgba(28, 25, 15, 0.74)",
                "rgba(19, 20, 12, 0.94)",
              ]
        }
        locations={[0, 0.22, 0.42, 1]}
        pointerEvents="none"
        className="absolute inset-0"
      />
      <View
        pointerEvents="none"
        style={{
          top: insets.top + 68,
        }}
        className="absolute right-0 left-0 items-center opacity-90"
      >
        <SunMark />
      </View>
      {children}
      <View
        pointerEvents="box-none"
        style={{
          top: insets.top + 8,
        }}
        className="absolute right-[22px] left-[22px] flex-row justify-between"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close verse"
          onPress={close}
          className="h-[44px] w-[44px] items-center justify-center rounded-[22px] bg-[rgba(22,26,22,0.25)] active:opacity-60"
        >
          <FontAwesome6 name="xmark" size={20} color="#FFF8E9" />
        </Pressable>
        {onShare ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share verse"
            onPress={onShare}
            className="h-[44px] w-[44px] items-center justify-center rounded-[22px] bg-[rgba(22,26,22,0.25)] active:opacity-60"
          >
            <FontAwesome6
              name="arrow-up-from-bracket"
              size={17}
              color="#FFF8E9"
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function VerseDetailScreen({
  verse,
  kind = "verse-of-the-day",
}: {
  verse: VerseDetailData;
  kind?: SavedVerse["kind"];
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { back, canGoBack, replace } = useRouter();
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const close = () => {
    if (canGoBack()) {
      back();
    } else {
      replace("/");
    }
  };
  const share = async () => {
    try {
      await Share.share({
        title: verse.book ?? "Scripture",
        message: [verse.text, verse.book].filter(Boolean).join("\n\n"),
      });
    } catch {
      Alert.alert("Unable to share", "Please try again.");
    }
  };

  return (
    <VerseFrame
      image={verse.image}
      onShare={() => {
        void share();
      }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator
        indicatorStyle="white"
        scrollIndicatorInsets={{
          top: insets.top + 64,
          bottom: 12,
        }}
        contentContainerStyle={{
          paddingTop: verse.image
            ? insets.top + 140
            : Math.max(insets.top + 130, height * 0.3),
        }}
        className="flex-1"
        contentContainerClassName={cn(
          "grow justify-end px-[30px] pb-xs",
          verse.image ? "justify-start" : "",
        )}
      >
        <View className="w-full max-w-[620px] items-center gap-[18px] self-center">
          {verse.image ? (
            <Image
              source={verse.image}
              contentFit="contain"
              cachePolicy="disk"
              enforceEarlyResizing
              recyclingKey={verse.image}
              accessibilityLabel={
                verse.book
                  ? `Scripture artwork for ${verse.book}`
                  : "Scripture artwork"
              }
              className="mb-[6px] aspect-square max-h-80 w-[80%] max-w-80 rounded-xl"
            />
          ) : null}
          <FontAwesome6
            name="quote-right"
            solid
            size={20}
            color="#F9E7C9"
            accessible={false}
          />
          <Text
            selectable
            className="font-scripture text-shadow-[0px_1px_5px_rgba(0,0,0,0.4)]"
            color="verseText"
            variant="scripture/regular"
            centered
          >
            {verse.text}
          </Text>
          <Text
            selectable
            className="leading-[22px]"
            color="verseReference"
            variant="body/regular"
            centered
          >
            {verse.book}
          </Text>
          <Text
            className="tracking-[1.5px]"
            color="verseLabel"
            variant="captionSm/regular"
            centered
            transform="uppercase"
          >
            {kind === "word-of-activation"
              ? "Word of Activation"
              : "Verse of the Day"}
          </Text>
        </View>
      </ScrollView>
      <View
        style={{
          paddingBottom: insets.bottom + 16,
        }}
        className="pt-5xs gap-4xs px-[30px]"
      >
        {saveFeedback ? (
          <Text
            accessibilityLiveRegion="polite"
            color="verseFeedback"
            variant="labelXXs/regular"
            centered
          >
            {saveFeedback}
          </Text>
        ) : null}
        <View className="gap-xs w-full max-w-[620px] flex-row items-center self-center">
          <SaveVerseButton
            verse={verse}
            kind={kind}
            onFeedback={setSaveFeedback}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done reading verse"
            onPress={close}
            className="gap-4xs px-xs min-h-[54px] flex-1 flex-row items-center justify-center rounded-[30px] bg-[rgba(255,247,223,0.2)] active:opacity-60"
          >
            <Text variant="body/medium" color="verseAction">
              Done
            </Text>
            <FontAwesome6 name="arrow-right" size={15} color="#FFF8E9" />
          </Pressable>
        </View>
      </View>
    </VerseFrame>
  );
}

export function VerseDetailStatus({
  title,
  offline = false,
  loading = false,
  children,
}: {
  title?: string;
  offline?: boolean;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <VerseFrame>
      <View className="flex-1 items-center justify-center gap-[18px] p-[30px]">
        {loading ? (
          <ActivityIndicator
            color="#FFF8E9"
            accessibilityLabel="Loading verse"
          />
        ) : null}
        {title ? (
          <Text
            selectable
            variant="headingXs/medium"
            centered
            color="verseAction"
          >
            {title}
          </Text>
        ) : null}
        {offline ? (
          <>
            <Text centered color="verseMuted">
              Connect to the internet, then try again.
            </Text>
            <Pressable
              accessibilityRole="button"
              className="gap-4xs px-xs min-h-[54px] min-w-[160px] flex-[0] flex-row items-center justify-center rounded-[30px] bg-[rgba(255,247,223,0.2)] active:opacity-60"
              onPress={() => {
                void connectivity.refresh().catch(() => undefined);
              }}
            >
              <Text color="verseAction" variant="body/regular">
                Try again
              </Text>
            </Pressable>
          </>
        ) : null}
        {children}
      </View>
    </VerseFrame>
  );
}
