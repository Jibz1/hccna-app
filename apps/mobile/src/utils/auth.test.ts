import { beforeEach, describe, expect, it, vi } from "vitest";

import { Auth } from "./auth";

const mocks = vi.hoisted(() => ({
  current: { uid: "a", isAnonymous: false } as {
    uid: string;
    isAnonymous: boolean;
  } | null,
  events: [] as string[],
  logoutFails: false,
  sync: vi.fn(),
  clear: vi.fn(async () => {}),
  resume: vi.fn(),
}));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: mocks.current }),
}));
vi.mock("@/effect/appRuntimeLive", () => ({
  runLiveAppEffect: async (effect: string) => {
    if (effect === "resume") {
      mocks.resume();
      return;
    }
    mocks.events.push("signOut");
    if (mocks.logoutFails) {
      throw new Error("native failure");
    }
    mocks.current = null;
  },
}));
vi.mock("@/effect/authService", () => ({
  signOutFromProvider: () => "logout",
}));
vi.mock("@/effect/authSessionService", () => ({ completeSignIn: vi.fn() }));
vi.mock("@/effect/pushRegistrationService", () => ({
  resumePushRegistration: () => "resume",
}));
vi.mock("@/utils/pushLogout", () => ({
  retirePushRegistration: () => {
    mocks.events.push("persistCleanup");
  },
  syncPushLogout: () => mocks.sync(),
}));
vi.mock("@/utils/pushRegistration", () => ({
  cancelAndClearPushRegistration: async () => {
    mocks.events.push("cancelRegistration");
  },
}));
vi.mock("@/utils/pushTokenRegistrationStore", () => ({
  pushTokenRegistrationStore: { clear: vi.fn() },
}));
vi.mock("@/utils/storageRegistry", () => ({
  clearUserScopedPersistence: mocks.clear,
}));
vi.mock("@/utils/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/utils/userData", () => ({ clearUserData: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = { uid: "a", isAnonymous: false };
  mocks.logoutFails = false;
  mocks.events.length = 0;
  mocks.sync.mockResolvedValue(undefined);
});

describe("Auth logout orchestration", () => {
  it("persists cleanup before signing out and completes local logout when offline", async () => {
    mocks.sync.mockRejectedValue(new Error("offline"));
    await Auth.signOutFromProvider("google", "a");
    expect(mocks.events).toEqual([
      "cancelRegistration",
      "persistCleanup",
      "signOut",
    ]);
    expect(mocks.clear).toHaveBeenCalledOnce();
  });
  it("preserves user caches and resumes push registration when Firebase sign-out fails", async () => {
    mocks.logoutFails = true;
    await expect(Auth.signOutFromProvider("google", "a")).rejects.toThrow(
      "native failure",
    );
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.resume).toHaveBeenCalledOnce();
  });
  it("does not clear or sign out an account that already changed", async () => {
    mocks.current = { uid: "b", isAnonymous: false };
    await expect(Auth.signOutFromProvider("google", "a")).rejects.toThrow(
      "session changed",
    );
    expect(mocks.events).toEqual([]);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
