import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  CAMPUS_LEAD_INTERVAL_MS,
  CAMPUS_LEAD_STAGGER_MS,
  useCampusLeadIndex,
  useCampusLeadPlayback,
} from "./useCampusLeadCycle";

const state = vi.hoisted(() => ({ autoplay: true, reduceMotion: false }));

vi.mock("@/hooks/useCarouselAutoplay", () => ({
  useCarouselAutoplay: () => ({ autoplay: state.autoplay, onLayout: vi.fn() }),
}));
vi.mock("react-native-reanimated", () => ({
  useReducedMotion: () => state.reduceMotion,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

function PlaybackProbe() {
  return createElement("Shown", { value: useCampusLeadPlayback() });
}

function IndexProbe({
  leadCount,
  order,
  playing,
}: {
  leadCount: number;
  order: number;
  playing: boolean;
}) {
  return createElement("Shown", {
    value: useCampusLeadIndex(leadCount, order, playing),
  });
}

function render(element: ReturnType<typeof createElement>) {
  act(() => {
    if (renderer) {
      renderer.update(element);
    } else {
      renderer = create(element);
    }
  });
}

const shown = () =>
  renderer?.root.find((node) => String(node.type) === "Shown").props.value;

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  state.autoplay = true;
  state.reduceMotion = false;
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

test("plays while Home is showing, pauses while hidden, stays still with reduced motion", () => {
  render(createElement(PlaybackProbe));
  expect(shown()).toBe("playing");

  state.autoplay = false;
  render(createElement(PlaybackProbe));
  expect(shown()).toBe("paused");

  state.reduceMotion = true;
  render(createElement(PlaybackProbe));
  expect(shown()).toBe("still");
});

test("waits half a second between cards and 30 seconds between a card's changes", () => {
  expect(CAMPUS_LEAD_STAGGER_MS).toBe(500);
  expect(CAMPUS_LEAD_INTERVAL_MS).toBe(30_000);
});

test("changes a card one stagger after the card before it, then every interval", () => {
  render(createElement(IndexProbe, { leadCount: 3, order: 2, playing: true }));
  expect(shown()).toBe(0);

  advance(CAMPUS_LEAD_STAGGER_MS * 3 - 1);
  expect(shown()).toBe(0);
  advance(1);
  expect(shown()).toBe(1);

  advance(CAMPUS_LEAD_INTERVAL_MS);
  expect(shown()).toBe(2);
  advance(CAMPUS_LEAD_INTERVAL_MS);
  expect(shown()).toBe(0);
});

test("holds the current lead with no timer running while paused", () => {
  render(createElement(IndexProbe, { leadCount: 2, order: 0, playing: true }));
  advance(CAMPUS_LEAD_STAGGER_MS);
  expect(shown()).toBe(1);

  render(createElement(IndexProbe, { leadCount: 2, order: 0, playing: false }));
  advance(CAMPUS_LEAD_INTERVAL_MS * 3);

  expect(shown()).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("never schedules a timer for a campus with one lead", () => {
  render(createElement(IndexProbe, { leadCount: 1, order: 0, playing: true }));

  expect(shown()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
