import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { AnimatedHeaderScrollProps } from "@/components/layout/AnimatedHeader";

import SermonsScreen from "./SermonsScreen";

type ScrollPosition = { get: () => number; set: (next: number) => void };

const state = vi.hoisted(() => ({
  shortsEnabled: true,
  header: null as { scrollY?: ScrollPosition } | null,
  useTabScreenLayout: vi.fn(
    (_horizontalPadding?: number, _overlay?: number) => ({
      topInset: 59,
      topOverlayOffset: 120,
      contentTop: 180,
      contentContainerStyle: { paddingTop: 239, paddingBottom: 142 },
    }),
  ),
}));

vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("@/components/design-v2/FeedbackCard", () => ({
  FeedbackCard: "FeedbackCard",
}));
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    useSharedValue: (initial: number) =>
      useRef({
        value: initial,
        get() {
          return this.value;
        },
        set(next: number) {
          this.value = next;
        },
      }).current,
  };
});
vi.mock("@/components/layout/AnimatedHeader", () => ({
  AnimatedHeader: (props: {
    children: (scrollProps: AnimatedHeaderScrollProps) => ReactNode;
    scrollY?: ScrollPosition;
  }) => {
    state.header = props;
    return props.children({});
  },
}));
vi.mock("@/components/layout/useTabScreenLayout", () => ({
  useTabScreenLayout: state.useTabScreenLayout,
}));
vi.mock("@/components/providers/ErrorBoundaryWithRetry", () => ({
  ErrorBoundaryWithRetry: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/sermons/SermonsContainer", () => ({
  SermonsContainer: "SermonsContainer",
  useHasCachedSermons: () => true,
}));
vi.mock("@/components/sermons/SermonsItems", () => ({
  SermonsListState: "SermonsListState",
}));
vi.mock("@/components/shorts/ShortsFeed", () => ({ ShortsFeed: "ShortsFeed" }));
vi.mock("@/components/shorts/useShortsFeedEnabled", () => ({
  useShortsFeedEnabled: () => state.shortsEnabled,
}));
vi.mock("@/effect/connectivity", () => ({
  connectivity: { refresh: () => Promise.resolve() },
}));
vi.mock("@/hooks/relay/useConnectivityAwareFetchPolicy", () => ({
  useConnectivityAwareFetchPolicy: () => "store-and-network",
}));
vi.mock("@/icons/WifiOff", () => ({ default: "WifiOffIcon" }));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: { accent: "orange" } }),
}));
vi.mock("@/ui/LoadingIndicator", () => ({
  LoadingIndicator: "LoadingIndicator",
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

function render() {
  act(() => {
    renderer = create(createElement(SermonsScreen));
  });
}

const all = (type: string) => renderer!.root.findAllByType(type as never);
const tablists = () =>
  renderer!.root.findAllByProps({ accessibilityRole: "tablist" });
const press = (label: string) => {
  act(() => {
    renderer!.root.findByProps({ accessibilityLabel: label }).props.onPress();
  });
};

beforeEach(() => {
  state.shortsEnabled = true;
  state.useTabScreenLayout.mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("hides the switch when the gate is off", () => {
  state.shortsEnabled = false;
  render();

  expect(tablists()).toHaveLength(0);
  expect(all("SermonsContainer")).toHaveLength(1);
  expect(all("ShortsFeed")).toHaveLength(0);
  // No overlay height: the layout is exactly what it was before Shorts existed.
  expect(state.useTabScreenLayout).toHaveBeenLastCalledWith(0, 0);
});

test("shows the switch and opens on Sermons when the gate is on", () => {
  render();

  expect(tablists()).toHaveLength(1);
  expect(all("SermonsContainer")).toHaveLength(1);
  expect(all("ShortsFeed")).toHaveLength(0);
});

test("reserves room for the switch once it has been measured", () => {
  render();

  const overlay = renderer!.root.findByProps({
    testID: "sermons-shorts-switch",
  });
  act(() => {
    overlay.props.onLayout({ nativeEvent: { layout: { height: 52 } } });
  });

  expect(state.useTabScreenLayout).toHaveBeenLastCalledWith(0, 52);
  expect(overlay.props.style).toEqual({ top: 120 });
});

test("shows the feed after switching to Shorts and unmounts it on switching back", () => {
  render();

  press("Shorts");
  expect(all("SermonsContainer")).toHaveLength(0);
  const [feed] = all("ShortsFeed");
  expect(feed?.props).toMatchObject({
    topPadding: 180,
    bottomPadding: 142,
    fetchPolicy: "store-and-network",
  });

  press("Sermons");
  expect(all("ShortsFeed")).toHaveLength(0);
  expect(all("SermonsContainer")).toHaveLength(1);
});

test("returns to Sermons if the gate turns off while Shorts is showing", () => {
  render();
  press("Shorts");
  expect(all("ShortsFeed")).toHaveLength(1);

  state.shortsEnabled = false;
  act(() => {
    renderer!.update(createElement(SermonsScreen));
  });

  expect(all("ShortsFeed")).toHaveLength(0);
  expect(all("SermonsContainer")).toHaveLength(1);
  expect(tablists()).toHaveLength(0);
});

// The header fades in a blur once the list under it has scrolled. Each side of
// the switch starts at the top, so a scroll position carried across left the
// blur drawn over the video and over an unscrolled sermons list.
test("returns the header to rest when the side changes", () => {
  render();
  const scrollY = state.header!.scrollY!;

  act(() => {
    scrollY.set(240);
  });
  press("Shorts");
  expect(scrollY.get()).toBe(0);

  act(() => {
    scrollY.set(80);
  });
  press("Sermons");
  expect(scrollY.get()).toBe(0);
});
