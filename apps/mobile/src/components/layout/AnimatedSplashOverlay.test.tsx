import { createElement, StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";

import { AnimatedSplashOverlay } from "./AnimatedSplashOverlay";

vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  Easing: { out: () => undefined, ease: () => undefined },
  FadeOut: { duration: () => ({ easing: () => undefined }) },
}));
vi.mock("@/cssInterop", () => ({ StyledLinearGradient: "LinearGradient" }));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({
    backgroundGradient: ["#FFFFFF", "#EEEEEE"],
    backgroundGradientLocations: [0, 1],
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

function render(appReady: boolean, onReadyToDisplay: () => void) {
  act(() => {
    const element = createElement(
      StrictMode,
      null,
      createElement(AnimatedSplashOverlay, { appReady, onReadyToDisplay }),
    );
    if (renderer) {
      renderer.update(element);
    } else {
      renderer = create(element);
    }
  });
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("waits for layout before dismissing an already-ready splash", () => {
  const onReady = vi.fn();
  render(true, onReady);

  expect(renderer!.toJSON()).not.toBeNull();
  expect(onReady).not.toHaveBeenCalled();
  act(() => {
    renderer!.root.findByProps({ pointerEvents: "auto" }).props.onLayout();
  });

  expect(onReady).toHaveBeenCalledOnce();
  expect(renderer!.toJSON()).toBeNull();
});

test("hands off once on layout and stays dismissed after readiness changes", () => {
  const onReady = vi.fn();
  render(false, onReady);
  const onLayout = renderer!.root.findByProps({ pointerEvents: "auto" }).props
    .onLayout;
  act(() => {
    onLayout();
    onLayout();
  });

  expect(onReady).toHaveBeenCalledOnce();
  expect(renderer!.toJSON()).not.toBeNull();
  render(true, onReady);
  expect(renderer!.toJSON()).toBeNull();
  render(false, onReady);
  expect(renderer!.toJSON()).toBeNull();
});

test("keeps the overlay mounted when readiness arrives before layout", () => {
  const onReady = vi.fn();
  render(false, onReady);
  render(true, onReady);

  expect(renderer!.toJSON()).not.toBeNull();
  act(() => {
    renderer!.root.findByProps({ pointerEvents: "auto" }).props.onLayout();
  });
  expect(onReady).toHaveBeenCalledOnce();
  expect(renderer!.toJSON()).toBeNull();
});
