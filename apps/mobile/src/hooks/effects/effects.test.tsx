import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  useEventListener,
  useExternalSync,
  useInterval,
  useMountEffect,
  useTimeout,
} from "./index";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

function render(element: ReturnType<typeof createElement>) {
  act(() => {
    if (renderer) {
      renderer.update(element);
    } else {
      renderer = create(element);
    }
  });
}

function unmount() {
  act(() => renderer?.unmount());
  renderer = undefined;
}

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
});

test("useMountEffect runs once and cleans up on unmount", () => {
  const cleanup = vi.fn();
  const effect = vi.fn(() => cleanup);
  function Probe({ tick }: { tick: number }) {
    useMountEffect(effect);
    return createElement("Tick", { tick });
  }
  render(createElement(Probe, { tick: 1 }));
  render(createElement(Probe, { tick: 2 }));
  render(createElement(Probe, { tick: 3 }));
  expect(effect).toHaveBeenCalledTimes(1);
  expect(cleanup).not.toHaveBeenCalled();
  unmount();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

function makeSource() {
  const listeners = new Set<(value: string) => void>();
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((listener: (value: string) => void) => {
    listeners.add(listener);
    return () => {
      unsubscribe();
      listeners.delete(listener);
    };
  });
  const emit = (value: string) => {
    for (const listener of listeners) {
      listener(value);
    }
  };
  return { emit, subscribe, unsubscribe };
}

test("useEventListener calls the latest handler without resubscribing", () => {
  const source = makeSource();
  const first = vi.fn();
  const second = vi.fn();
  function Probe({ handler }: { handler: (value: string) => void }) {
    useEventListener(source.subscribe, handler);
    return null;
  }
  render(createElement(Probe, { handler: first }));
  render(createElement(Probe, { handler: second }));
  expect(source.subscribe).toHaveBeenCalledTimes(1);
  source.emit("hello");
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("hello");
  unmount();
  expect(source.unsubscribe).toHaveBeenCalledTimes(1);
});

test("useEventListener resubscribes when subscribe changes", () => {
  const a = makeSource();
  const b = makeSource();
  const handler = vi.fn();
  function Probe({ subscribe }: { subscribe: typeof a.subscribe }) {
    useEventListener(subscribe, handler);
    return null;
  }
  render(createElement(Probe, { subscribe: a.subscribe }));
  render(createElement(Probe, { subscribe: b.subscribe }));
  expect(a.unsubscribe).toHaveBeenCalledTimes(1);
  expect(a.subscribe).toHaveBeenCalledTimes(1);
  expect(b.subscribe).toHaveBeenCalledTimes(1);
  expect(b.unsubscribe).not.toHaveBeenCalled();
  unmount();
  expect(a.unsubscribe).toHaveBeenCalledTimes(1);
  expect(b.unsubscribe).toHaveBeenCalledTimes(1);
});

test("useExternalSync runs on mount and on change only", () => {
  const calls: string[] = [];
  const sync = vi.fn((value: string) => {
    calls.push(`sync:${value}`);
    return () => {
      calls.push(`cleanup:${value}`);
    };
  });
  function Probe({ value }: { value: string }) {
    useExternalSync(value, sync);
    return null;
  }
  render(createElement(Probe, { value: "a" }));
  expect(sync).toHaveBeenCalledTimes(1);
  expect(sync).toHaveBeenLastCalledWith("a");
  render(createElement(Probe, { value: "a" }));
  expect(sync).toHaveBeenCalledTimes(1);
  render(createElement(Probe, { value: "b" }));
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync).toHaveBeenLastCalledWith("b");
  expect(calls).toEqual(["sync:a", "cleanup:a", "sync:b"]);
});

function TimeoutProbe({
  callback,
  delayMs,
  resetKey,
}: {
  callback: () => void;
  delayMs: number | null;
  resetKey?: number;
}) {
  useTimeout(callback, delayMs, resetKey);
  return null;
}

test("useTimeout fires once after the delay", () => {
  const callback = vi.fn();
  render(createElement(TimeoutProbe, { callback, delayMs: 1000 }));
  advance(999);
  expect(callback).not.toHaveBeenCalled();
  advance(1);
  expect(callback).toHaveBeenCalledTimes(1);
  advance(4000);
  expect(callback).toHaveBeenCalledTimes(1);
});

test("useTimeout restarts on resetKey change and cancels on null", () => {
  const callback = vi.fn();
  render(createElement(TimeoutProbe, { callback, delayMs: 1000, resetKey: 1 }));
  advance(600);
  render(createElement(TimeoutProbe, { callback, delayMs: 1000, resetKey: 2 }));
  advance(400);
  expect(callback).not.toHaveBeenCalled();
  advance(600);
  expect(callback).toHaveBeenCalledTimes(1);

  const cancelled = vi.fn();
  unmount();
  render(createElement(TimeoutProbe, { callback: cancelled, delayMs: 1000 }));
  advance(600);
  render(createElement(TimeoutProbe, { callback: cancelled, delayMs: null }));
  advance(5000);
  expect(cancelled).not.toHaveBeenCalled();
});

test("a new callback mid-delay keeps the timer and only the new callback runs", () => {
  const first = vi.fn();
  const second = vi.fn();
  render(createElement(TimeoutProbe, { callback: first, delayMs: 1000 }));
  advance(600);
  render(createElement(TimeoutProbe, { callback: second, delayMs: 1000 }));
  advance(400);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);

  unmount();
  const tickA = vi.fn();
  const tickB = vi.fn();
  function IntervalProbe({ callback }: { callback: () => void }) {
    useInterval(callback, 1000);
    return null;
  }
  render(createElement(IntervalProbe, { callback: tickA }));
  advance(1600);
  expect(tickA).toHaveBeenCalledTimes(1);
  render(createElement(IntervalProbe, { callback: tickB }));
  advance(400);
  expect(tickA).toHaveBeenCalledTimes(1);
  expect(tickB).toHaveBeenCalledTimes(1);
});

test("useInterval ticks until paused", () => {
  const callback = vi.fn();
  function Probe({ delayMs }: { delayMs: number | null }) {
    useInterval(callback, delayMs);
    return null;
  }
  render(createElement(Probe, { delayMs: 1000 }));
  advance(3000);
  expect(callback).toHaveBeenCalledTimes(3);
  render(createElement(Probe, { delayMs: null }));
  advance(5000);
  expect(callback).toHaveBeenCalledTimes(3);
});
