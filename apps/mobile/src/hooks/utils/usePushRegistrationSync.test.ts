import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { PUSH_REGISTRATION_SETTLE_MS } from "@/effect/pushRegistrationService";

import { usePushRegistrationSync } from "./usePushRegistrationSync";

vi.mock("@/utils/pushLogout", () => ({
  syncPushLogout: vi.fn(async () => {}),
}));

const mocks = vi.hoisted(() => ({
  connectivityListeners: new Set<() => void>(),
  runLiveAppEffect: vi.fn(async () => undefined),
}));

vi.mock("@/effect/appRuntimeLive", () => ({
  runLiveAppEffect: mocks.runLiveAppEffect,
}));
vi.mock("@/effect/connectivity", () => ({
  connectivity: {
    subscribeForegrounded: () => () => {},
    subscribeConnectivityRestored: (listener: () => void) => {
      mocks.connectivityListeners.add(listener);
      return () => mocks.connectivityListeners.delete(listener);
    },
  },
}));
vi.mock("@/utils/sentry", () => ({ captureException: vi.fn() }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
function Harness({ enabled }: { enabled: boolean }) {
  usePushRegistrationSync(enabled);
  return null;
}
async function render(enabled = true) {
  await act(async () => {
    renderer = create(createElement(Harness, { enabled }));
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
  mocks.connectivityListeners.clear();
  vi.useRealTimers();
});

test("waits for the app to settle before resuming queued registrations", async () => {
  await render();
  await advance(PUSH_REGISTRATION_SETTLE_MS - 1);
  expect(mocks.runLiveAppEffect).not.toHaveBeenCalled();
  await advance(1);
  expect(mocks.runLiveAppEffect).toHaveBeenCalledOnce();
});

test("waits again after connectivity returns", async () => {
  await render();
  await advance(PUSH_REGISTRATION_SETTLE_MS);
  await act(async () => {
    mocks.connectivityListeners.forEach((listener) => {
      listener();
    });
  });
  await advance(PUSH_REGISTRATION_SETTLE_MS - 1);
  expect(mocks.runLiveAppEffect).toHaveBeenCalledOnce();
  await advance(1);
  expect(mocks.runLiveAppEffect).toHaveBeenCalledTimes(2);
});

test("never syncs after unmounting", async () => {
  await render();
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
  await advance(60_000);
  expect(mocks.runLiveAppEffect).not.toHaveBeenCalled();
});
