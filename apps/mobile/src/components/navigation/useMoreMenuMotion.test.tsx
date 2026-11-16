import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useMoreMenuMotion } from "./useMoreMenuMotion";

type RemovePrevented = (event: {
  data: { action: { type: string } };
  repeat: () => void;
}) => void;

const state = vi.hoisted(() => ({
  reduceMotion: false,
  preventRemove: [] as boolean[],
  onRemovePrevented: undefined as RemovePrevented | undefined,
  finishTiming: undefined as (() => void) | undefined,
}));

vi.mock("expo-router/react-navigation", () => ({
  usePreventRemove: (preventRemove: boolean, callback: RemovePrevented) => {
    state.preventRemove.push(preventRemove);
    state.onRemovePrevented = callback;
  },
}));
vi.mock("react-native-reanimated", () => ({
  cancelAnimation: vi.fn(),
  Easing: { inOut: (easing: string) => easing, cubic: "cubic" },
  Extrapolation: { CLAMP: "clamp" },
  interpolate: () => 0,
  ReduceMotion: { System: "system" },
  useAnimatedStyle: () => ({}),
  useDerivedValue: (compute: () => unknown) => ({ get: compute }),
  useReducedMotion: () => state.reduceMotion,
  useSharedValue: (initial: number) => {
    let value = initial;
    return {
      get: () => value,
      set: (next: number) => {
        value = next;
      },
    };
  },
  withSpring: (to: number) => to,
  withTiming: (
    to: number,
    _config: { duration: number },
    callback: (finished: boolean) => void,
  ) => {
    state.finishTiming = () => {
      callback(true);
    };
    return to;
  },
}));
vi.mock("react-native-worklets", () => ({
  scheduleOnRN: (callback: () => void) => {
    callback();
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

function MenuProbe() {
  useMoreMenuMotion(56);
  return null;
}

const removePrevented = (repeat: () => void) => {
  act(() => {
    state.onRemovePrevented?.({
      data: { action: { type: "GO_BACK" } },
      repeat,
    });
  });
};

beforeEach(() => {
  state.reduceMotion = false;
  state.preventRemove = [];
  state.onRemovePrevented = undefined;
  state.finishTiming = undefined;
  act(() => {
    renderer = create(createElement(MenuProbe));
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("replays the blocked removal with repeat once the exit finishes", () => {
  const repeat = vi.fn();
  expect(state.preventRemove.at(-1)).toBe(true);

  removePrevented(repeat);
  expect(repeat).not.toHaveBeenCalled();

  act(() => state.finishTiming?.());

  expect(repeat).toHaveBeenCalledTimes(1);
  expect(state.preventRemove.at(-1)).toBe(false);
});

test("ignores removal attempts while the exit is running", () => {
  const repeat = vi.fn();

  removePrevented(repeat);
  removePrevented(repeat);
  act(() => state.finishTiming?.());

  expect(repeat).toHaveBeenCalledTimes(1);
});

test("does not prevent removal with reduced motion", () => {
  act(() => renderer?.unmount());
  state.reduceMotion = true;
  act(() => {
    renderer = create(createElement(MenuProbe));
  });

  expect(state.preventRemove.at(-1)).toBe(false);
});
