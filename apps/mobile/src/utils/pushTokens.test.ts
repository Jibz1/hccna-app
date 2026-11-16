import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  clearConfirmedRegistration,
  getConfirmedRegistration,
  runLiveAppEffect,
  statsigLogEvent,
  registerPushToken,
} = vi.hoisted(() => ({
  clearConfirmedRegistration: vi.fn(),
  getConfirmedRegistration: vi.fn(),
  runLiveAppEffect: vi.fn(),
  statsigLogEvent: vi.fn(),
  registerPushToken: vi.fn((input) => ({ input })),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/effect/appRuntimeLive", () => ({ runLiveAppEffect }));
vi.mock("@/effect/pushRegistrationService", () => ({
  REGISTER_PUSH_TOKEN_TIMEOUT_MS: 15_000,
  registerPushToken,
}));
vi.mock("@/utils/pushTokenRegistrationStore", () => ({
  pushTokenRegistrationStore: {
    clear: clearConfirmedRegistration,
    get: getConfirmedRegistration,
  },
}));
vi.mock("@/utils/statsig", () => ({
  statsig: { logEvent: statsigLogEvent },
}));

describe("push tokens", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("does not include tokens in error telemetry", async () => {
    runLiveAppEffect.mockRejectedValue(new Error("network failed"));
    const { PushTokens } = await import("@/utils/pushTokens");

    await expect(
      PushTokens.updatePushTokens({
        subscriptions: {
          channels: ["events"],
          preferredCampus: { version: 2 },
        },
        fcmToken: "fcm-secret",
      }),
    ).resolves.toEqual({ status: "failed" });

    expect(JSON.stringify(statsigLogEvent.mock.calls)).not.toContain(
      "fcm-secret",
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "fcm-secret",
    );
  });
});
