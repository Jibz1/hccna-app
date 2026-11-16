import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Share,
  View,
} from "react-native";
import YoutubePlayer, {
  type YoutubeIframeRef,
} from "react-native-youtube-iframe";

import {
  StyledImage as Image,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

import { ShortPlaybackProgress } from "./ShortPlaybackProgress";

type Short = {
  readonly videoId: string;
  readonly title: string;
  readonly thumbnail: string | null | undefined;
};

/**
 * How long the player may take to load, and then again to start playing,
 * before the page offers a retry.
 */
const PLAYER_START_TIMEOUT_MS = 20_000;
/**
 * How long the player must stay paused, while the app wants it playing, before
 * the page shows it as paused. YouTube also reports "paused" just before a
 * short ends and while it seeks; those are followed at once by buffering,
 * playing or ended.
 */
const UNASKED_PAUSE_SETTLE_MS = 500;
/**
 * The player library's default page, hosted on the web, ignores the play, pause
 * and mute commands this version of the library sends, so its bundled page is
 * used. YouTube refuses an embed that has no referrer; the bundled page gets
 * the app's id as its origin.
 */
const PLAYER_ORIGIN = "https://org.hccnj.app";
/**
 * Runs in every frame of the player's web view.
 *
 * In the bundled page: that page keeps its video in a 16:9 box. A short is
 * 9:16, so the box is stretched to the whole web view, which is already 9:16.
 *
 * In YouTube's own frame: YouTube draws a title, channel icon, pause button
 * and logo over a short when it starts and when it pauses. Everything there is
 * hidden except the video and its captions. Android runs injected scripts in
 * the top frame only, so YouTube's paused overlay can remain visible there.
 */
const PLAYER_PAGE_SCRIPT = `(function () {
  var host = location.hostname;
  var inYouTube = host === "www.youtube.com" || host === "www.youtube-nocookie.com";
  var style = document.createElement("style");
  style.textContent = inYouTube
    ? "body{background:#000!important}body *:not(video):not(:has(video)):not(.ytp-caption-window-container):not(.ytp-caption-window-container *){visibility:hidden!important;pointer-events:none!important}"
    : "html,body{height:100%;background:#000}.container{height:100%!important;padding-bottom:0!important}";
  (document.head || document.documentElement).appendChild(style);
})();
true;`;
// A dark disc keeps the icon readable over any frame of the video.
const iconButtonClassName =
  "size-11 items-center justify-center rounded-full border border-white/20 bg-black/35 active:opacity-70";

function Poster({ thumbnail }: { thumbnail: string | null | undefined }) {
  return thumbnail ? (
    <Image
      source={thumbnail}
      contentFit="cover"
      cachePolicy="disk"
      accessible={false}
      className="absolute inset-0 h-full w-full"
    />
  ) : null;
}

/**
 * Mounted only for the page the pager has settled on, so leaving a short drops
 * its WebView and forgets a pause along with it.
 */
function ActiveShortPlayer({
  short,
  height,
  canPlay,
  muted,
  overlayBottom,
}: {
  short: Short;
  height: number;
  canPlay: boolean;
  muted: boolean;
  overlayBottom: number;
}) {
  const { colors } = useAppTheme();
  const playerRef = useRef<YoutubeIframeRef>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [userPaused, setUserPaused] = useState(false);
  // The poster covers startup. On iOS a paused short keeps its frame and its
  // captions. On Android it is covered again, because the script that hides
  // YouTube's title, channel icon and suggestions cannot run there.
  const [covered, setCovered] = useState(true);
  const pendingPause = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shouldPlay = canPlay && !userPaused;
  // YouTube can accept a short and still never start it (a sign-in or age
  // prompt, blocked autoplay). Its own prompts are hidden, so time that out too.
  const awaitingStart =
    status === "loading" || (status === "ready" && covered && shouldPlay);

  const showPaused = () => {
    setUserPaused(true);
    if (Platform.OS === "android") {
      setCovered(true);
    }
  };

  const dropPendingPause = () => {
    clearTimeout(pendingPause.current);
    pendingPause.current = undefined;
  };

  // A pause still pending when the feed stops for its own reasons (tab change,
  // app in the background) can no longer be told apart from the app's pause.
  useEffect(() => {
    if (!shouldPlay) {
      dropPendingPause();
    }
    return dropPendingPause;
  }, [shouldPlay]);

  // `status` is a dependency so that loading and starting each get the whole
  // allowance.
  useEffect(() => {
    if (!awaitingStart) {
      return;
    }
    const timer = setTimeout(() => {
      setStatus("error");
    }, PLAYER_START_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [awaitingStart, status]);

  if (status === "error") {
    return (
      <View className="absolute inset-0 items-center justify-center gap-3 px-6">
        <Text variant="bodyLg/medium" color="white" centered>
          Unable to play this video
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={() => {
            setUserPaused(false);
            setCovered(true);
            setStatus("loading");
          }}
          className="min-h-11 items-center justify-center rounded-full bg-white px-5 py-2.5 active:opacity-70"
        >
          <Text variant="body/medium" color="black">
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <View
        style={{ width: (height * 9) / 16, height }}
        className="self-center overflow-hidden"
      >
        <YoutubePlayer
          ref={playerRef}
          videoId={short.videoId}
          width={(height * 9) / 16}
          height={height}
          play={shouldPlay}
          mute={muted}
          forceAndroidAutoplay
          useLocalHTML
          baseUrlOverride={PLAYER_ORIGIN}
          // No YouTube controls: the touch layer below covers the player.
          initialPlayerParams={{
            rel: false,
            preventFullScreen: true,
            controls: false,
          }}
          onChangeState={(nextState: string) => {
            if (nextState === "paused") {
              if (shouldPlay) {
                // The app only pauses by turning `play` off, and the touch
                // layer keeps taps away from the player. A pause that arrives
                // while `play` is on, and lasts, came from outside the app: a
                // call, Siri, another app's audio. Show it as paused, so one
                // tap resumes.
                dropPendingPause();
                pendingPause.current = setTimeout(
                  showPaused,
                  UNASKED_PAUSE_SETTLE_MS,
                );
              }
              return;
            }
            dropPendingPause();
            if (nextState === "playing") {
              setUserPaused(false);
              setCovered(false);
            } else if (nextState === "ended") {
              playerRef.current?.seekTo(0, true);
            }
          }}
          onReady={() => {
            setStatus("ready");
          }}
          onError={() => {
            setStatus("error");
          }}
          webViewProps={{
            injectedJavaScript: PLAYER_PAGE_SCRIPT,
            injectedJavaScriptForMainFrameOnly: false,
            onError: () => {
              setStatus("error");
            },
            onHttpError: () => {
              setStatus("error");
            },
          }}
        />
        {covered ? (
          <View className="absolute inset-0 bg-black" pointerEvents="none">
            <Poster thumbnail={short.thumbnail} />
            {status === "loading" ? (
              <View
                accessibilityLabel={`Loading ${short.title}`}
                accessibilityRole="progressbar"
                className="h-full items-center justify-center bg-black/25"
              >
                <ActivityIndicator color={colors.onImage} size="large" />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {/*
        A full-screen YouTube player keeps vertical drags for itself, so the
        feed could not be swiped from the video. This layer takes every touch
        instead: the list scrolls on a drag, and a tap pauses or plays.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={userPaused ? "Play" : "Pause"}
        onPress={() => {
          dropPendingPause();
          if (userPaused) {
            setUserPaused(false);
          } else {
            showPaused();
          }
        }}
        className="absolute inset-0 items-center justify-center"
      >
        {userPaused ? (
          <View className="size-18 items-center justify-center rounded-full bg-black/45">
            <FontAwesome6 name="play" size={28} color={colors.onImage} />
          </View>
        ) : null}
      </Pressable>
      {status === "ready" ? (
        <ShortPlaybackProgress
          playerRef={playerRef}
          running={shouldPlay}
          bottom={overlayBottom}
        />
      ) : null}
    </>
  );
}

export function ShortPage({
  short,
  width,
  height,
  overlayTop,
  overlayBottom,
  isActive,
  canPlay,
  muted,
  onToggleMute,
}: {
  short: Short;
  /** Page width. */
  width: number;
  /** Page height: the whole screen. */
  height: number;
  /** Header and switch clearance for the top scrim. */
  overlayTop: number;
  /** How far the buttons sit above the page's foot, to clear the tab bar. */
  overlayBottom: number;
  /** This is the page the pager has settled on. */
  isActive: boolean;
  /** The feed is visible: tab focused, app active. */
  canPlay: boolean;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const { colors } = useAppTheme();
  // Fill tall phones, cropping the sides; keep a centered column on tablets.
  const playerWidth = (height * 9) / 16;
  const youtubeUrl = `https://www.youtube.com/shorts/${short.videoId}`;

  const share = async () => {
    try {
      await Share.share({
        title: short.title,
        message: `${short.title}\n\n${youtubeUrl}`,
      });
    } catch {
      Alert.alert("Unable to share", "Please try again.");
    }
  };

  return (
    <View
      style={{ width, height }}
      accessibilityElementsHidden={!isActive}
      importantForAccessibility={isActive ? "auto" : "no-hide-descendants"}
      className="overflow-hidden bg-black"
    >
      {isActive ? (
        <ActiveShortPlayer
          key={short.videoId}
          short={short}
          height={height}
          canPlay={canPlay}
          muted={muted}
          overlayBottom={overlayBottom}
        />
      ) : (
        <View
          style={{ width: playerWidth, height }}
          className="self-center overflow-hidden"
        >
          <Poster thumbnail={short.thumbnail} />
        </View>
      )}
      <LinearGradient
        pointerEvents="none"
        colors={[colors.overlay, "transparent"]}
        style={{ height: overlayTop + 40 }}
        className="absolute top-0 right-0 left-0"
      />
      <LinearGradient
        pointerEvents="none"
        colors={["transparent", colors.overlay]}
        style={{ height: overlayBottom + 180 }}
        className="absolute right-0 bottom-0 left-0"
      />
      {/*
        The video carries its own captions and branding, so nothing else is
        drawn over it except playback controls: no duplicate title or captions.
      */}
      <View
        testID="short-actions"
        // Only the buttons take touches; a tap elsewhere reaches the player.
        pointerEvents="box-none"
        style={{ bottom: overlayBottom + 48 }}
        className="absolute right-4 items-center gap-4"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          onPress={onToggleMute}
          className={iconButtonClassName}
        >
          <FontAwesome6
            name={muted ? "volume-xmark" : "volume-high"}
            size={20}
            color={colors.onImage}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share"
          onPress={share}
          className={iconButtonClassName}
        >
          <FontAwesome6
            name="arrow-up-from-bracket"
            size={20}
            color={colors.onImage}
          />
        </Pressable>
      </View>
    </View>
  );
}
