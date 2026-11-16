import {
  createElement,
  type ElementType,
  Fragment,
  type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { getSermonRoute } from "./sermon.utils";
import { SermonsHero } from "./SermonsHero";

type CarouselProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  onSnapToItem: (index: number) => void;
};

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  carousel: null as CarouselProps | null,
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ navigate: state.navigate }),
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  cancelAnimation: () => undefined,
  Easing: { inOut: () => () => 0, quad: () => 0 },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: (value: number) => ({
    value,
    get: () => value,
    set: () => undefined,
  }),
  withRepeat: (animation: number) => animation,
  withTiming: (value: number) => value,
}));
vi.mock("react-native-reanimated-carousel", () => ({
  Carousel: (props: CarouselProps) => {
    state.carousel = props;
    return createElement(
      "Carousel",
      null,
      props.data.map((item, index) =>
        createElement(
          Fragment,
          { key: index },
          props.renderItem({ item, index }),
        ),
      ),
    );
  },
}));
vi.mock("@/cssInterop", () => ({
  StyledImage: "Image",
  StyledLinearGradient: "LinearGradient",
}));
vi.mock("@/components/layout/CarouselPagination", () => ({
  StraightPagination: "StraightPagination",
}));
vi.mock("@/hooks/useCarouselAutoplay", () => ({
  useCarouselAutoplay: () => ({ autoplay: false, onLayout: () => undefined }),
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: { background: "#211c19" } }),
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

const sermons = Array.from({ length: 7 }, (_, index) => ({
  slug: `sample-sermon-${index + 1}`,
  title: `Sample Sermon ${index + 1}`,
  thumbnail: `https://example.com/sermon-${index + 1}.jpg`,
  speakerFullName: "Ada Example",
  speakerImage: null,
  youtubeLink: `https://youtu.be/sample${index + 1}`,
}));

function render(items: readonly (typeof sermons)[number][]) {
  act(() => {
    renderer = create(createElement(SermonsHero, { sermons: items }));
  });
}

function watchNow(title: string) {
  return renderer!.root.findByProps({ accessibilityLabel: `Watch ${title}` });
}

function pageDots() {
  return renderer!.root.findAllByType("StraightPagination" as ElementType);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.carousel = null;
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("features the five newest sermons", () => {
  render(sermons);

  expect(state.carousel?.data).toHaveLength(5);
  expect(
    renderer!.root.findAllByProps({ children: "Sample Sermon 1" }),
  ).not.toHaveLength(0);
  expect(
    renderer!.root.findAllByProps({ children: "Sample Sermon 6" }),
  ).toHaveLength(0);
});

test("Watch Now opens the sermon on screen", () => {
  render(sermons);

  act(() => {
    watchNow("Sample Sermon 1").props.onPress();
  });
  expect(state.navigate).toHaveBeenLastCalledWith(getSermonRoute(sermons[0]));

  act(() => {
    state.carousel!.onSnapToItem(2);
  });
  act(() => {
    watchNow("Sample Sermon 3").props.onPress();
  });
  expect(state.navigate).toHaveBeenLastCalledWith(getSermonRoute(sermons[2]));
});

// The carousel keeps the visible slide by key when data changes without
// reporting a snap, so a stale index would aim Watch Now at another sermon.
test("Watch Now follows the newest sermon after the featured list changes", () => {
  render(sermons);
  act(() => {
    state.carousel!.onSnapToItem(2);
  });

  const published = { ...sermons[0], slug: "new-sermon", title: "New Sermon" };
  act(() => {
    renderer!.update(
      createElement(SermonsHero, { sermons: [published, ...sermons] }),
    );
  });
  act(() => {
    watchNow("New Sermon").props.onPress();
  });

  expect(state.navigate).toHaveBeenLastCalledWith(getSermonRoute(published));
});

test("shows page dots only when there is more than one sermon", () => {
  render(sermons);
  expect(pageDots()).toHaveLength(1);

  act(() => renderer?.unmount());
  render(sermons.slice(0, 1));
  expect(pageDots()).toHaveLength(0);
});

test("renders nothing without sermons", () => {
  render([]);

  expect(renderer!.toJSON()).toBeNull();
});
