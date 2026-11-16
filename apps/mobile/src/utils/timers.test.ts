import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { sleep, withTimeout } from "./timers";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("sleep resolves after the delay", async () => {
  let done = false;
  void sleep(100).then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(99);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(true);
});

test("sleep resolves at once when aborted", async () => {
  const controller = new AbortController();
  const promise = sleep(10_000, controller.signal);
  controller.abort();
  await promise;
  expect(vi.getTimerCount()).toBe(0);
});

test("sleep resolves at once for an already-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await sleep(10_000, controller.signal);
  expect(vi.getTimerCount()).toBe(0);
});

test("withTimeout returns the result and clears its timer", async () => {
  await expect(
    withTimeout(
      async () => "done",
      1000,
      () => new Error("late"),
    ),
  ).resolves.toBe("done");
  expect(vi.getTimerCount()).toBe(0);
});

test("withTimeout aborts and rejects on timeout", async () => {
  const timeoutError = new Error("timed out");
  let seen: AbortSignal | undefined;
  const promise = withTimeout(
    (signal) => {
      seen = signal;
      return new Promise<string>(() => {});
    },
    1000,
    () => timeoutError,
  );
  const assertion = expect(promise).rejects.toBe(timeoutError);
  await vi.advanceTimersByTimeAsync(1000);
  await assertion;
  expect(seen?.aborted).toBe(true);
});

test("withTimeout clears its timer when run throws synchronously", async () => {
  const own = new Error("own");
  const onTimeout = vi.fn(() => new Error("timed out"));
  await expect(
    withTimeout(
      () => {
        throw own;
      },
      1000,
      onTimeout,
    ),
  ).rejects.toBe(own);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(2000);
  expect(onTimeout).not.toHaveBeenCalled();
});

test("withTimeout passes through a rejection from run", async () => {
  const own = new Error("own");
  await expect(
    withTimeout(
      () => Promise.reject(own),
      1000,
      () => new Error("timed out"),
    ),
  ).rejects.toBe(own);
  expect(vi.getTimerCount()).toBe(0);
});
