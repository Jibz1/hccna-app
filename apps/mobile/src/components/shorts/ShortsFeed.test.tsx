import {
  createElement,
  Fragment,
  Suspense,
  useImperativeHandle,
  type ReactNode,
  type Ref,
} from "react";
import { RelayEnvironmentProvider } from "react-relay";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  createOperationDescriptor,
  Environment,
  Network,
  RecordSource,
  Store,
} from "relay-runtime";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";

import ShortsFeedQueryNode from "./__generated__/ShortsFeedQuery.graphql";
import { ShortsFeed } from "./ShortsFeed";

type Entry = { key: string; short: { videoId: string } };
type ListProps = {
  data: readonly Entry[];
  renderItem: (info: { item: Entry; index: number }) => ReactNode;
  keyExtractor: (item: Entry) => string;
  onMomentumScrollEnd: (event: {
    nativeEvent: { contentOffset: { y: number } };
  }) => void;
  onScrollEndDrag: (event: {
    nativeEvent: { contentOffset: { y: number } };
  }) => void;
  pagingEnabled?: boolean;
  ref?: Ref<{
    scrollToIndex: (target: { index: number; animated: boolean }) => void;
  }>;
};
type PageProps = {
  short: { videoId: string };
  width: number;
  height: number;
  overlayBottom: number;
  isActive: boolean;
  canPlay: boolean;
  muted: boolean;
  onToggleMute: () => void;
};

const state = vi.hoisted(() => ({
  focused: true,
  appActive: true,
  list: null as ListProps | null,
  scrollToIndex: vi.fn(),
}));

vi.mock("@sentry/react-native", async () => {
  const { ErrorBoundary } = await import("react-error-boundary");
  return {
    ErrorBoundary: ({
      children,
      fallback,
    }: {
      children: ReactNode;
      fallback: (props: { resetError: () => void }) => ReactNode;
    }) => (
      <ErrorBoundary
        fallbackRender={({ resetErrorBoundary }) =>
          fallback({ resetError: resetErrorBoundary })
        }
      >
        {children}
      </ErrorBoundary>
    ),
  };
});
vi.mock("expo-router", () => ({ useIsFocused: () => state.focused }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/cssInterop", () => ({
  StyledLegendList: (props: ListProps) => {
    state.list = props;
    useImperativeHandle(props.ref, () => ({
      scrollToIndex: state.scrollToIndex,
    }));
    return createElement(
      "LegendList",
      null,
      props.data.map((item, index) =>
        createElement(
          Fragment,
          { key: props.keyExtractor(item) },
          props.renderItem({ item, index }),
        ),
      ),
    );
  },
}));
vi.mock("react-relay", async (importOriginal) => {
  const relay = await importOriginal<typeof import("react-relay")>();
  const query = (await import("./__generated__/ShortsFeedQuery.graphql"))
    .default;
  return { ...relay, graphql: () => query };
});
vi.mock("@/components/design-v2/FeedbackCard", () => ({
  FeedbackCard: "FeedbackCard",
}));
vi.mock("@/effect/connectivity", () => ({
  connectivity: { refresh: () => Promise.resolve() },
}));
vi.mock("@/hooks/useIsAppActive", () => ({
  useIsAppActive: () => state.appActive,
}));
vi.mock("@/icons/WarningTriangular", () => ({ default: "WarningIcon" }));
vi.mock("@/icons/WifiOff", () => ({ default: "WifiOffIcon" }));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: { accent: "orange" } }),
}));
vi.mock("@/ui/LoadingIndicator", () => ({
  LoadingIndicator: "LoadingIndicator",
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("./ShortPage", () => ({ ShortPage: "ShortPage" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

const short = (n: number) => ({
  __typename: "Short",
  id: `Short:aaaaaaaaaa${n}`,
  videoId: `aaaaaaaaaa${n}`,
  title: `Sample short ${n}`,
  channelTitle: "Example Channel",
  thumbnail: null,
  curated: false,
});

/** Never answers, so anything rendered came from the store. */
function makeEnvironment() {
  return new Environment({
    network: Network.create(() => new Promise<never>(() => undefined)),
    store: new Store(new RecordSource()),
  });
}

function commit(environment: Environment, shorts: ReturnType<typeof short>[]) {
  environment.commitPayload(
    createOperationDescriptor(ShortsFeedQueryNode, {}),
    { shorts },
  );
}

function feedElement(
  environment: Environment,
  fetchPolicy: ConnectivityAwareFetchPolicy,
) {
  return (
    <RelayEnvironmentProvider environment={environment}>
      <Suspense fallback="Loading shorts">
        <ShortsFeed
          topPadding={100}
          bottomPadding={120}
          fetchPolicy={fetchPolicy}
        />
      </Suspense>
    </RelayEnvironmentProvider>
  );
}

async function openFeed(
  shorts: ReturnType<typeof short>[] | null,
  fetchPolicy: ConnectivityAwareFetchPolicy = "store-and-network",
) {
  const environment = makeEnvironment();
  if (shorts) {
    commit(environment, shorts);
  }
  await act(async () => {
    renderer = create(feedElement(environment, fetchPolicy));
  });
  return environment;
}

async function setConnectivity(
  environment: Environment,
  fetchPolicy: ConnectivityAwareFetchPolicy,
) {
  await act(async () => {
    renderer!.update(feedElement(environment, fetchPolicy));
  });
}

function layOut(width: number, height: number) {
  const frame = renderer!.root.findByProps({ testID: "shorts-pager-frame" });
  act(() => {
    frame.props.onLayout({ nativeEvent: { layout: { width, height } } });
  });
}

function settleAt(offsetY: number) {
  act(() => {
    state.list!.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { y: offsetY } },
    });
  });
}

function endDragAt(offsetY: number) {
  act(() => {
    state.list!.onScrollEndDrag({
      nativeEvent: { contentOffset: { y: offsetY } },
    });
  });
}

const pages = () =>
  renderer!.root
    .findAllByType("ShortPage" as never)
    .map((page) => page.props as PageProps);

beforeEach(() => {
  state.focused = true;
  state.appActive = true;
  state.list = null;
  state.scrollToIndex.mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("shows the empty message for an empty list", async () => {
  await openFeed([]);

  expect(
    renderer!.root.findAllByProps({
      children: "No shorts yet. Check back soon.",
    }),
  ).not.toHaveLength(0);
  expect(pages()).toHaveLength(0);
});

test("shows the offline card when offline even with a cached list", async () => {
  await openFeed([short(1), short(2)], "store-only");

  const card = renderer!.root.findByType("FeedbackCard" as never);
  expect(card.props.title).toBe("Shorts unavailable offline");
  expect(pages()).toHaveLength(0);
});

test("renders no pages until the pager has been measured", async () => {
  await openFeed([short(1), short(2), short(3)]);
  expect(pages()).toHaveLength(0);

  layOut(390, 700);

  expect(pages()).toHaveLength(3);
  expect(
    pages().every((page) => page.width === 390 && page.height === 700),
  ).toBe(true);
  expect(state.list!.pagingEnabled).toBe(true);
});

test("starts on the first page", async () => {
  await openFeed([short(1), short(2), short(3)]);
  layOut(390, 700);

  expect(pages().map((page) => page.isActive)).toEqual([true, false, false]);
});

test("marks only the settled page active", async () => {
  await openFeed([short(1), short(2), short(3), short(4), short(5)]);
  layOut(390, 700);

  settleAt(1400);

  expect(pages().map((page) => page.isActive)).toEqual([
    false,
    false,
    true,
    false,
    false,
  ]);
});

// A slow drag released exactly on a page starts no momentum, so no momentum
// end follows it.
test("marks the page active when a drag ends at rest on it", async () => {
  await openFeed([short(1), short(2), short(3), short(4), short(5)]);
  layOut(390, 700);

  endDragAt(700);

  expect(pages().map((page) => page.isActive)).toEqual([
    false,
    true,
    false,
    false,
    false,
  ]);
});

test("waits for the snap when a drag ends between pages", async () => {
  await openFeed([short(1), short(2), short(3), short(4), short(5)]);
  layOut(390, 700);

  endDragAt(450);

  expect(pages().findIndex((page) => page.isActive)).toBe(0);
});

test("returns to the playing page when the screen changes size", async () => {
  await openFeed([short(1), short(2), short(3), short(4), short(5)]);
  layOut(820, 1180);
  settleAt(2360);
  expect(state.scrollToIndex).not.toHaveBeenCalled();

  // Rotated: every page is now a different height.
  layOut(1180, 820);

  expect(state.scrollToIndex).toHaveBeenCalledWith({
    index: 2,
    animated: false,
  });
  expect(pages().findIndex((page) => page.isActive)).toBe(2);
});

test("keeps the feed and its place when the connection drops while watching", async () => {
  const environment = await openFeed([
    short(1),
    short(2),
    short(3),
    short(4),
    short(5),
  ]);
  layOut(390, 700);
  settleAt(1400);
  const order = state.list!.data.map((entry) => entry.key);

  await setConnectivity(environment, "store-only");

  expect(renderer!.root.findAllByType("FeedbackCard" as never)).toHaveLength(0);
  expect(pages().findIndex((page) => page.isActive)).toBe(2);
  expect(state.list!.data.map((entry) => entry.key)).toEqual(order);

  await setConnectivity(environment, "store-and-network");

  expect(pages().findIndex((page) => page.isActive)).toBe(2);
  expect(state.list!.data.map((entry) => entry.key)).toEqual(order);
});

test("stops playback when the tab loses focus", async () => {
  state.focused = false;
  await openFeed([short(1), short(2), short(3)]);
  layOut(390, 700);

  expect(pages().some((page) => page.canPlay)).toBe(false);
});

test("stops playback when the app is in the background", async () => {
  state.appActive = false;
  await openFeed([short(1), short(2), short(3)]);
  layOut(390, 700);

  expect(pages().some((page) => page.canPlay)).toBe(false);
});

test("plays while the tab is focused and the app is active", async () => {
  await openFeed([short(1), short(2), short(3)]);
  layOut(390, 700);

  expect(pages().every((page) => page.canPlay)).toBe(true);
});

test("appends another pass near the end", async () => {
  await openFeed([short(1), short(2), short(3)]);
  layOut(390, 700);
  expect(state.list!.data).toHaveLength(3);

  settleAt(700);

  expect(state.list!.data).toHaveLength(6);
  expect(new Set(state.list!.data.map((entry) => entry.key)).size).toBe(6);
});

test("lets a single short be swiped again and again", async () => {
  await openFeed([short(1)]);
  layOut(390, 700);

  expect(state.list!.data.length).toBeGreaterThanOrEqual(3);
  expect(new Set(state.list!.data.map((entry) => entry.key)).size).toBe(
    state.list!.data.length,
  );
});

test("shares one mute state across every page", async () => {
  await openFeed([short(1), short(2), short(3)]);
  layOut(390, 700);

  act(() => {
    pages()[0]?.onToggleMute();
  });

  expect(pages().every((page) => page.muted)).toBe(true);
  settleAt(700);
  expect(pages().find((page) => page.isActive)?.muted).toBe(true);

  act(() => {
    pages()
      .find((page) => page.isActive)
      ?.onToggleMute();
  });
  expect(pages().every((page) => !page.muted)).toBe(true);
});

test("keeps page keys unique when the list grows after the first pass", async () => {
  const environment = await openFeed([short(1)]);
  layOut(390, 700);

  // The refetch lands with more shorts than the cached list had.
  await act(async () => {
    commit(environment, [short(1), short(2), short(3)]);
  });
  settleAt(700);

  const keys = state.list!.data.map((entry) => entry.key);
  expect(keys.length).toBeGreaterThan(3);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.every((key) => /^\d+:/u.test(key))).toBe(true);
});

const surface = () =>
  renderer!.root.findByProps({ testID: "shorts-feed-surface" });

test("shows the loading state on the dark feed", async () => {
  await openFeed(null);

  expect(surface().props.className).toContain("bg-black");
  expect(surface().findAllByType("LoadingIndicator" as never)).toHaveLength(1);
});

test("shows the empty message on the dark feed", async () => {
  await openFeed([]);

  expect(
    surface().findAllByProps({ children: "No shorts yet. Check back soon." }),
  ).not.toHaveLength(0);
});

// The feed is full screen: the video runs under the header, the switch and the
// tab bar. Only the title strip keeps clear of the tab bar.
test("gives the pager the whole screen and tells pages where the tab bar is", async () => {
  await openFeed([short(1), short(2), short(3)]);
  layOut(390, 844);

  expect(surface().props.style).toBeUndefined();
  expect(pages().every((page) => page.height === 844)).toBe(true);
  expect(pages().every((page) => page.overlayBottom === 120)).toBe(true);
});

test("keeps the loading, empty and offline states clear of the header and tab bar", async () => {
  await openFeed([]);
  expect(
    renderer!.root.findByProps({ testID: "shorts-feed-state" }).props.style,
  ).toEqual({ paddingTop: 100, paddingBottom: 120 });

  act(() => renderer?.unmount());
  renderer = undefined;
  await openFeed(null);
  expect(
    renderer!.root.findByProps({ testID: "shorts-feed-state" }).props.style,
  ).toEqual({ paddingTop: 100, paddingBottom: 120 });

  act(() => renderer?.unmount());
  renderer = undefined;
  await openFeed([short(1)], "store-only");
  expect(
    renderer!.root.findByProps({ testID: "shorts-feed-state" }).props.style,
  ).toEqual({ paddingTop: 100, paddingBottom: 120 });
});
