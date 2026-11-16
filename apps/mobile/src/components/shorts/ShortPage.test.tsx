import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ShortPage } from "./ShortPage";

type PlayerProps = {
  videoId: string;
  play: boolean;
  mute: boolean;
  onChangeState: (state: string) => void;
  onReady: () => void;
  onError: () => void;
  initialPlayerParams?: { controls?: boolean };
  useLocalHTML?: boolean;
  baseUrlOverride?: string;
  webViewProps?: {
    injectedJavaScript?: string;
    injectedJavaScriptForMainFrameOnly?: boolean;
  };
  ref?: { current: unknown };
};

const state = vi.hoisted(() => ({
  player: null as PlayerProps | null,
  seekTo: vi.fn(),
  getCurrentTime: vi.fn(() => Promise.resolve(15)),
  getDuration: vi.fn(() => Promise.resolve(60)),
  share: vi.fn(() => Promise.resolve({ action: "sharedAction" })),
  alert: vi.fn(),
  platform: { OS: "ios" },
}));

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: state.alert },
  Platform: state.platform,
  Pressable: "Pressable",
  Share: { share: state.share },
  View: "View",
}));
vi.mock("react-native-youtube-iframe", () => ({
  default: (props: PlayerProps) => {
    state.player = props;
    if (props.ref) {
      props.ref.current = {
        seekTo: state.seekTo,
        getCurrentTime: state.getCurrentTime,
        getDuration: state.getDuration,
      };
    }
    return createElement("YoutubePlayer");
  },
}));
vi.mock("@/cssInterop", () => ({
  StyledImage: "Image",
  StyledLinearGradient: "LinearGradient",
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: { onImage: "#ffffff" } }),
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof ShortPage>[0];

const baseProps: Props = {
  short: {
    videoId: "aaaaaaaaaa1",
    title: "Sample short one",
    thumbnail: "https://example.com/1.jpg",
  },
  width: 390,
  height: 700,
  overlayTop: 180,
  overlayBottom: 120,
  isActive: true,
  canPlay: true,
  muted: false,
  onToggleMute: () => undefined,
};

let renderer: ReactTestRenderer | undefined;

function render(overrides: Partial<Props> = {}) {
  const element = createElement(ShortPage, { ...baseProps, ...overrides });
  act(() => {
    if (renderer) {
      renderer.update(element);
    } else {
      renderer = create(element);
    }
  });
}

const players = () => renderer!.root.findAllByType("YoutubePlayer" as never);
const byLabel = (label: string) =>
  renderer!.root.findAllByProps({ accessibilityLabel: label });
const emit = (playerState: string) => {
  act(() => {
    state.player!.onChangeState(playerState);
  });
};

/** Long enough for a pause to count as the person's. */
const settle = () => {
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.getCurrentTime.mockResolvedValue(15);
  state.getDuration.mockResolvedValue(60);
  state.player = null;
  state.platform.OS = "ios";
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

test("mounts a player only for the active page", () => {
  render({ isActive: false });
  expect(players()).toHaveLength(0);

  render({ isActive: true });
  expect(players()).toHaveLength(1);
  expect(state.player!.videoId).toBe("aaaaaaaaaa1");
});

// The library's hosted page (its default) drops the play, pause and mute
// commands this version sends, so a short never started by itself. Its own
// bundled page handles them, and YouTube needs that page to have an origin.
test("loads the player page that obeys play and pause, with an origin", () => {
  render();

  expect(state.player?.useLocalHTML).toBe(true);
  expect(state.player?.baseUrlOverride).toMatch(/^https:\/\/[\w.-]+$/u);
});

// That page keeps its video in a 16:9 box, which shrank a vertical short to a
// strip at the top of the frame.
test("lets the video fill the 9:16 frame", () => {
  render();

  const script = state.player?.webViewProps?.injectedJavaScript ?? "";
  expect(script).toContain(".container{height:100%!important");
  expect(script).toContain("padding-bottom:0!important");
  // WebView warns unless an injected script ends in a value.
  expect(script.trimEnd().endsWith("true;")).toBe(true);
});

// A full-screen YouTube player keeps vertical drags for itself, so a swipe on
// the video never reached the feed. A touch layer over the player gives drags
// to the feed and turns a tap into pause and play.
test("pauses and resumes when the video is tapped", () => {
  render();
  expect(state.player?.play).toBe(true);

  act(() => {
    byLabel("Pause")[0]?.props.onPress();
  });
  expect(state.player?.play).toBe(false);
  expect(byLabel("Pause")).toHaveLength(0);

  act(() => {
    byLabel("Play")[0]?.props.onPress();
  });
  expect(state.player?.play).toBe(true);
});

// YouTube draws a title, channel icon, pause button and logo inside its own
// frame whenever a short starts. Only a script that also runs inside that frame
// can hide them, leaving the video and its captions.
test("hides everything YouTube draws over the video, inside YouTube's frame", () => {
  render();

  const props = state.player?.webViewProps;
  expect(props?.injectedJavaScriptForMainFrameOnly).toBe(false);
  const script = props?.injectedJavaScript ?? "";
  expect(script).toMatch(/youtube(-nocookie)?\\?\.com/u);
  expect(script).toContain(":not(video):not(:has(video))");
  expect(script).toContain("ytp-caption-window-container");
});

const posters = () => renderer!.root.findAllByType("Image" as never);

// The poster covers startup until the first video frame is playing.
test("keeps the poster over the player until the short is playing", async () => {
  render();
  expect(posters()).toHaveLength(1);

  await act(async () => {
    state.player!.onReady();
  });
  expect(posters()).toHaveLength(1);

  emit("playing");
  expect(posters()).toHaveLength(0);
});

test("preserves the current video frame when paused and resumed", async () => {
  render();
  await act(async () => {
    state.player!.onReady();
  });
  emit("playing");

  act(() => {
    byLabel("Pause")[0]?.props.onPress();
  });
  expect(posters()).toHaveLength(0);

  // Resuming must not flash the thumbnail over the paused frame.
  await act(async () => {
    byLabel("Play")[0]?.props.onPress();
  });
  expect(posters()).toHaveLength(0);

  emit("playing");
  expect(posters()).toHaveLength(0);
});

test("preserves the video frame when YouTube pauses by itself", async () => {
  render();
  await act(async () => {
    state.player!.onReady();
  });
  emit("playing");

  emit("paused");
  settle();

  expect(posters()).toHaveLength(0);
  expect(byLabel("Play")).not.toHaveLength(0);
});

test("hides YouTube's own controls, which the touch layer covers", () => {
  render();

  expect(state.player?.initialPlayerParams?.controls).toBe(false);
});

test("has no touch layer on pages that are not playing", () => {
  render({ isActive: false });

  expect(byLabel("Pause")).toHaveLength(0);
  expect(byLabel("Play")).toHaveLength(0);
});

test("plays only while the feed can play", () => {
  render({ canPlay: false });
  expect(state.player!.play).toBe(false);

  render({ canPlay: true });
  expect(state.player!.play).toBe(true);
});

test("stays paused after the person pauses", () => {
  render();
  emit("playing");
  emit("paused");
  settle();
  expect(state.player!.play).toBe(false);

  render({ canPlay: false });
  render({ canPlay: true });
  expect(state.player!.play).toBe(false);

  emit("playing");
  expect(state.player!.play).toBe(true);
});

test("does not treat a forced pause as the person's", () => {
  render();
  emit("playing");

  render({ canPlay: false });
  emit("paused");
  render({ canPlay: true });

  expect(state.player!.play).toBe(true);
});

// YouTube also reports "paused" while the seek bar is dragged and just before a
// short ends. Those are not the person pausing, and latching them left the
// short stopped.
test("ignores the pause YouTube emits while scrubbing", () => {
  render();
  emit("playing");
  emit("paused");
  // Not yet the person's: turning play off here would make the app pause the video itself.
  expect(state.player!.play).toBe(true);
  emit("buffering");
  emit("playing");
  settle();

  expect(state.player!.play).toBe(true);
});

test("ignores a pause right before the short ends", () => {
  render();
  emit("playing");
  emit("paused");
  emit("ended");
  settle();

  expect(state.seekTo).toHaveBeenCalledWith(0, true);
  expect(state.player!.play).toBe(true);
});

test("drops a pending pause when the feed stops playing for its own reasons", () => {
  render();
  emit("playing");
  emit("paused");
  render({ canPlay: false });
  settle();
  render({ canPlay: true });

  expect(state.player!.play).toBe(true);
});

test("forgets a pause when the page is left", () => {
  render();
  emit("playing");
  emit("paused");
  settle();
  expect(state.player!.play).toBe(false);

  render({ isActive: false });
  render({ isActive: true });

  expect(state.player!.play).toBe(true);
});

test("replays when the short ends", () => {
  render();
  emit("playing");
  emit("ended");

  expect(state.seekTo).toHaveBeenCalledTimes(1);
  expect(state.seekTo).toHaveBeenCalledWith(0, true);
  expect(state.player!.play).toBe(true);
});

test("shows a retry after a player error", () => {
  render();
  act(() => {
    state.player!.onError();
  });

  expect(players()).toHaveLength(0);
  expect(
    renderer!.root.findAllByProps({ children: "Unable to play this video" }),
  ).not.toHaveLength(0);

  const [retry] = byLabel("Try again");
  act(() => {
    retry.props.onPress();
  });

  expect(players()).toHaveLength(1);
});

test("gives up on a player that never becomes ready", () => {
  render();
  act(() => {
    vi.advanceTimersByTime(20_000);
  });

  expect(players()).toHaveLength(0);
  expect(byLabel("Try again")).not.toHaveLength(0);
});

// YouTube can accept a short and still never start it (a sign-in or age
// prompt, blocked autoplay). Its prompts are hidden, so the app must say so.
test("gives up on a ready player that never starts playing", async () => {
  render();
  await act(async () => {
    state.player!.onReady();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });

  expect(players()).toHaveLength(0);
  expect(byLabel("Try again")).not.toHaveLength(0);
});

test("keeps waiting on a ready player while the feed cannot play", async () => {
  render({ canPlay: false });
  await act(async () => {
    state.player!.onReady();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(players()).toHaveLength(1);
});

test("never gives up on a short that has played", async () => {
  render();
  await act(async () => {
    state.player!.onReady();
  });
  emit("playing");
  act(() => {
    byLabel("Pause")[0]?.props.onPress();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(players()).toHaveLength(1);
});

// Android cannot run the script that hides YouTube's overlay, and YouTube
// draws a title, channel icon and suggestions over a paused short.
test("covers a paused short with its poster on Android", async () => {
  state.platform.OS = "android";
  render();
  await act(async () => {
    state.player!.onReady();
  });
  emit("playing");
  expect(posters()).toHaveLength(0);

  act(() => {
    byLabel("Pause")[0]?.props.onPress();
  });
  expect(posters()).toHaveLength(1);

  // The poster stays until the video is really playing again.
  await act(async () => {
    byLabel("Play")[0]?.props.onPress();
  });
  expect(posters()).toHaveLength(1);

  emit("playing");
  expect(posters()).toHaveLength(0);
});

test("covers a short YouTube paused by itself on Android", async () => {
  state.platform.OS = "android";
  render();
  await act(async () => {
    state.player!.onReady();
  });
  emit("playing");

  emit("paused");
  settle();

  expect(posters()).toHaveLength(1);
  expect(byLabel("Play")).not.toHaveLength(0);
});

test("starts muted with an unmute control when asked", () => {
  const onToggleMute = vi.fn();
  render({ muted: true, onToggleMute });
  expect(state.player!.mute).toBe(true);

  const [unmute] = byLabel("Unmute");
  act(() => {
    unmute.props.onPress();
  });
  expect(onToggleMute).toHaveBeenCalledTimes(1);

  render({ muted: false, onToggleMute });
  expect(state.player!.mute).toBe(false);
  expect(byLabel("Unmute")).toHaveLength(0);
  act(() => {
    byLabel("Mute")[0]?.props.onPress();
  });
  expect(onToggleMute).toHaveBeenCalledTimes(2);
});

test("shares the shorts link", async () => {
  render();

  const [share] = byLabel("Share");
  await act(async () => {
    await share.props.onPress();
  });

  expect(state.share).toHaveBeenCalledWith({
    title: "Sample short one",
    message: "Sample short one\n\nhttps://www.youtube.com/shorts/aaaaaaaaaa1",
  });
});

// The video carries its own captions and branding; the page adds no title,
// channel name or YouTube link on top of it.
test("keeps video captions clear of duplicate titles and metadata", () => {
  render();

  expect(
    renderer!.root.findAllByProps({ children: "Sample short one" }),
  ).toHaveLength(0);
  expect(
    renderer!.root.findAllByProps({ children: "Example Channel" }),
  ).toHaveLength(0);
  expect(byLabel("Open in YouTube")).toHaveLength(0);
  expect(renderer!.root.findAllByType("LinearGradient" as never)).toHaveLength(
    2,
  );
  expect(byLabel("Share")).not.toHaveLength(0);
  expect(byLabel("Unmute")).toHaveLength(0);
});

test("fills a tall phone with video without stretching its aspect ratio", () => {
  render({ width: 360, height: 700 });

  // Full height, cropping the sides of the 9:16 video to fill the phone.
  expect(state.player).toMatchObject({ width: 393.75, height: 700 });
});

test("uses the full height on a wide screen", () => {
  render({ width: 800, height: 1000 });

  // 9:16 of the 1000 height is 562.5 wide: a centered column.
  expect(state.player).toMatchObject({ width: 562.5, height: 1000 });
});

test("floats the share button over the video, clear of the tab bar", () => {
  render({ overlayBottom: 120 });

  const actions = renderer!.root.findByProps({ testID: "short-actions" });
  expect(actions.props.style).toEqual({ bottom: 168 });
  expect(actions.props.className).toContain("absolute");
  // Only the buttons take touches; a tap anywhere else reaches the player.
  expect(actions.props.pointerEvents).toBe("box-none");
});

test("tracks actual video time and returns to the start when it loops", async () => {
  render();
  expect(byLabel("Video progress")).toHaveLength(0);
  await act(async () => {
    state.player!.onReady();
  });
  expect(byLabel("Video progress")[0]?.props.accessibilityValue.now).toBe(25);

  state.getCurrentTime.mockResolvedValue(30);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(byLabel("Video progress")[0]?.props.accessibilityValue.now).toBe(50);

  emit("ended");
  state.getCurrentTime.mockResolvedValue(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(byLabel("Video progress")[0]?.props.accessibilityValue.now).toBe(0);
});

test("stops progress polling when paused, backgrounded or unmounted", async () => {
  render();
  await act(async () => {
    state.player!.onReady();
  });
  act(() => {
    byLabel("Pause")[0]?.props.onPress();
  });
  const pausedReads = state.getCurrentTime.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(state.getCurrentTime).toHaveBeenCalledTimes(pausedReads);

  await act(async () => {
    byLabel("Play")[0]?.props.onPress();
  });
  expect(state.getCurrentTime.mock.calls.length).toBeGreaterThan(pausedReads);
  render({ canPlay: false });
  const backgroundReads = state.getCurrentTime.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(state.getCurrentTime).toHaveBeenCalledTimes(backgroundReads);

  render({ isActive: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(state.getCurrentTime).toHaveBeenCalledTimes(backgroundReads);
  expect(byLabel("Video progress")).toHaveLength(0);
});

test("recovers progress readings without interrupting playback", async () => {
  state.getCurrentTime.mockRejectedValueOnce(new Error("Player not ready"));
  render();
  await act(async () => {
    state.player!.onReady();
  });
  expect(byLabel("Video progress")[0]?.props.accessibilityValue.now).toBe(0);
  expect(state.player!.play).toBe(true);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(byLabel("Video progress")[0]?.props.accessibilityValue.now).toBe(25);
});

// The player library's readings never reject or time out by themselves.
test("keeps tracking after a progress reading goes unanswered", async () => {
  state.getCurrentTime.mockReturnValueOnce(
    new Promise<number>(() => undefined),
  );
  render();
  await act(async () => {
    state.player!.onReady();
  });
  expect(byLabel("Video progress")[0]?.props.accessibilityValue.now).toBe(0);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });

  expect(byLabel("Video progress")[0]?.props.accessibilityValue.now).toBe(25);
});

test("reads a short's length once, not on every tick", async () => {
  render();
  await act(async () => {
    state.player!.onReady();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });

  expect(state.getCurrentTime.mock.calls.length).toBeGreaterThan(2);
  expect(state.getDuration).toHaveBeenCalledTimes(1);
});
