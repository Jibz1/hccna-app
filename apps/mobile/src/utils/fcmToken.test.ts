import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { addBreadcrumb } from "@/utils/sentry";

import { getFcmToken } from "./fcmToken";

// Use React Native's actual polyfill, which lacks signal.reason/throwIfAborted.
const { AbortController } = require("node:module").createRequire(
  import.meta.resolve("react-native"),
)("abort-controller");

const mocks = vi.hoisted(() => ({ getToken: vi.fn(), status: "online" }));
vi.mock("@react-native-firebase/messaging", () => ({
  getMessaging: () => ({}),
  getToken: mocks.getToken,
}));
vi.mock("@/effect/connectivity", () => ({
  connectivity: { getSnapshot: () => mocks.status },
}));

vi.mock("@/utils/sentry", () => ({ addBreadcrumb: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.getToken.mockReset();
  mocks.status = "online";
});
afterEach(() => vi.useRealTimers());

function networkError(nativeErrorCode = -1005) {
  // Match NativeFirebaseError's non-enumerable properties.
  return Object.defineProperties(new Error("Localized network failure"), {
    code: { value: "messaging/unknown", enumerable: false },
    nativeErrorCode: { value: nativeErrorCode, enumerable: false },
  });
}

test("retries transient failures with bounded backoff and returns the token", async () => {
  mocks.getToken
    .mockRejectedValueOnce(networkError())
    .mockResolvedValue("token");
  const result = getFcmToken(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(999);
  expect(mocks.getToken).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toBe("token");
  expect(mocks.getToken).toHaveBeenCalledTimes(2);
});

test.each([-1001, -1003, -1004, -1005, -1009, -1200])(
  "defers persistent network error %s after four attempts with one warning breadcrumb",
  async (code) => {
    const error = networkError(code);
    mocks.getToken.mockRejectedValue(error);
    const result = expect(
      getFcmToken(new AbortController().signal),
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(7_000);
    await result;
    expect(mocks.getToken).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    expect(addBreadcrumb).toHaveBeenCalledExactlyOnceWith({
      category: "push.registration",
      message: "FCM token acquisition deferred after network retries",
      level: "warning",
      data: {
        reason: "network_retries_exhausted",
        attempts: 4,
        code: "messaging/unknown",
        nativeErrorCode: code,
      },
    });
  },
);

test.each([
  Object.assign(
    new Error("A TLS error caused the secure connection to fail."),
    { code: "messaging/unknown" },
  ),
  Object.assign(new Error("The network connection was lost."), {
    code: "messaging/unknown",
  }),
  Object.defineProperties(
    new Error("java.io.IOException: SERVICE_NOT_AVAILABLE"),
    {
      code: { value: "messaging/unknown", enumerable: false },
      nativeErrorCode: { value: "unknown", enumerable: false },
    },
  ),
  Object.assign(new Error("Network unavailable"), {
    code: "messaging/network-request-failed",
  }),
])(
  "recognizes the reported network failures when native codes are unavailable: %s",
  async (error) => {
    mocks.getToken.mockRejectedValueOnce(error).mockResolvedValue("token");
    const result = getFcmToken(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBe("token");
  },
);

test.each([
  Object.assign(new Error("Invalid sender"), { code: "messaging/unknown" }),
  Object.assign(new Error("java.io.IOException: AUTHENTICATION_FAILED"), {
    code: "messaging/unknown",
    nativeErrorCode: "unknown",
  }),
  Object.assign(new Error("Not registered"), {
    code: "messaging/unregistered",
  }),
  Object.assign(new Error("Certificate is untrusted"), {
    code: "messaging/unknown",
    nativeErrorCode: -1202,
  }),
])("preserves permanent errors without retrying: %s", async (error) => {
  mocks.getToken.mockRejectedValue(error);
  await expect(getFcmToken(new AbortController().signal)).rejects.toBe(error);
  expect(mocks.getToken).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(addBreadcrumb).not.toHaveBeenCalled();
});

test("shares a pending native request while honoring each caller's cancellation", async () => {
  let resolve!: (token: string) => void;
  mocks.getToken.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const firstController = new AbortController();
  const first = expect(
    getFcmToken(firstController.signal),
  ).resolves.toBeUndefined();
  firstController.abort();
  const second = getFcmToken(new AbortController().signal);
  expect(mocks.getToken).toHaveBeenCalledTimes(1);
  resolve("token");
  await first;
  await expect(second).resolves.toBe("token");
});

test("cancels backoff when the registration is retired", async () => {
  mocks.getToken.mockRejectedValue(networkError());
  const controller = new AbortController();
  const result = expect(
    getFcmToken(controller.signal),
  ).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await result;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.getToken).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("defers token acquisition while offline", async () => {
  mocks.status = "offline";
  await expect(
    getFcmToken(new AbortController().signal),
  ).resolves.toBeUndefined();
  expect(mocks.getToken).not.toHaveBeenCalled();
  expect(addBreadcrumb).toHaveBeenCalledExactlyOnceWith({
    category: "push.registration",
    message: "FCM token acquisition deferred by connectivity status",
    level: "info",
    data: { reason: "offline", attempts: 0 },
  });
});

test("stops retries if connectivity is lost during backoff", async () => {
  mocks.getToken.mockRejectedValue(networkError());
  const result = getFcmToken(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(0);
  mocks.status = "offline";
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(result).resolves.toBeUndefined();
  expect(mocks.getToken).toHaveBeenCalledTimes(1);
});
