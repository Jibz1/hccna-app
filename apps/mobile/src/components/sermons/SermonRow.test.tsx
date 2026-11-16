import { createElement, type ElementType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { getSermonRoute } from "./sermon.utils";
import { SermonRow } from "./SermonRow";

const state = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ navigate: state.navigate }),
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { absoluteFill: {}, create: <T,>(styles: T) => styles },
}));
vi.mock("@/cssInterop", () => ({ StyledImage: "Image" }));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: { accent: "#f1b58f" } }),
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

const sermon = {
  title: "Sample Sermon",
  thumbnail: "https://example.com/sermon.jpg",
  speakerFullName: "Ada Example",
  speakerImage: null,
  youtubeLink: "https://youtu.be/sample",
};

function render(props: Parameters<typeof SermonRow>[0]) {
  act(() => {
    renderer = create(createElement(SermonRow, props));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("shows the speaker under the title and opens the player", () => {
  render(sermon);

  expect(
    renderer!.root.findAllByProps({ children: "Sample Sermon" }),
  ).not.toHaveLength(0);
  expect(
    renderer!.root.findAllByProps({ children: "Ada Example" }),
  ).not.toHaveLength(0);

  const row = renderer!.root.findByProps({
    accessibilityLabel: "Play Sample Sermon by Ada Example",
  });
  act(() => {
    row.props.onPress();
  });
  expect(state.navigate).toHaveBeenCalledWith(getSermonRoute(sermon));
});

test("falls back to a generic title and leaves out a missing speaker", () => {
  render({ ...sermon, title: "  ", speakerFullName: null });

  expect(
    renderer!.root.findByProps({ accessibilityLabel: "Play Sermon" }).type,
  ).toBe("Pressable");
  expect(renderer!.root.findAllByType("Text" as ElementType)).toHaveLength(1);
});
