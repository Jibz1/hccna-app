import type { getMessaging } from "@react-native-firebase/messaging";
import { createElement, StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { PUSH_REGISTRATION_SETTLE_MS } from "@/effect/pushRegistrationService";
import * as subscriptionHook from "@/hooks/utils/usePushSubscriptions";
import type { DevicePrefsDoc } from "@/utils/devicePrefsSchema";
import { addBreadcrumb, captureException } from "@/utils/sentry";

import {
  usePushNotifications,
  type PushNotificationState,
} from "./usePushNotifications";

const mocks = vi.hoisted(() => ({
  user: { uid: "user-1", email: "member@example.com", isAnonymous: false } as {
    uid: string;
    email: string | null;
    isAnonymous: boolean;
  } | null,
  authenticatedUid: "user-1" as string | undefined,
  prefs: {} as Partial<DevicePrefsDoc>,
  prefsListeners: new Set<() => void>(),
  appListeners: new Set<(state: string) => void>(),
  tokenListeners: new Set<() => void>(),
  connectivityListeners: new Set<() => void>(),
  getPermission: vi.fn(),
  getFcmToken: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@/effect/appRuntimeLive", () => ({
  runLiveAppEffect: vi.fn(async () => undefined),
}));
vi.mock("@/effect/graphqlNetworkService", () => ({
  ensureGraphQLClientIdentity: vi.fn(),
}));
vi.mock("@/effect/connectivity", () => ({
  connectivity: {
    getSnapshot: () => "online",
    subscribeConnectivityRestored: (listener: () => void) => {
      mocks.connectivityListeners.add(listener);
      return () => mocks.connectivityListeners.delete(listener);
    },
  },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.appListeners.add(listener);
      return { remove: () => mocks.appListeners.delete(listener) };
    },
  },
}));
vi.mock("expo-device", () => ({ isDevice: true }));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: mocks.user }),
  onAuthStateChanged: () => () => {},
}));
vi.mock("@/hooks/relay/useUserData", () => ({
  useAuthenticatedUid: () => mocks.authenticatedUid,
  shouldRefreshUserDataQuery: () => false,
  recordUserDataQueryRefresh: vi.fn(),
  fetchUserProfileQuery: vi.fn(async () => null),
}));
vi.mock("@/utils/relayPersistence", () => ({
  getRelayAuthScope: (uid?: string) => (uid ? `uid:${uid}` : "anon"),
}));
vi.mock("@/environment", () => ({ environmentAtom: {} }));
vi.mock("jotai", () => {
  const state = {
    get authScope() {
      return mocks.user?.isAnonymous
        ? "anon"
        : mocks.authenticatedUid
          ? `uid:${mocks.authenticatedUid}`
          : "anon";
    },
    environment: {},
  };
  return { useAtomValue: () => state };
});
vi.mock("@/hooks/relay/usePreferredCampus", () => ({
  usePreferredCampus: () => ({ version: 0, isLoaded: true }),
}));
vi.mock("@/hooks/utils/useNotificationSettingsEnabled", () => ({
  useNotificationSettingsEnabled: () => true,
}));
vi.mock("@/hooks/utils/useNotificationRouting", () => ({
  useNotificationRouting: vi.fn(),
}));
vi.mock("@/utils/pushTokenRegistrationStore", () => ({
  pushTokenRegistrationStore: {
    subscribe: () => () => {},
    getRevision: () => 0,
  },
}));
vi.mock("@react-native-firebase/messaging", () => ({
  getMessaging: () => ({}),
  getToken: mocks.getFcmToken,
  onTokenRefresh: (
    _messaging: ReturnType<typeof getMessaging>,
    listener: () => void,
  ) => {
    mocks.tokenListeners.add(listener);
    return () => mocks.tokenListeners.delete(listener);
  },
}));
vi.mock("expo-notifications", () => ({
  IosAuthorizationStatus: { PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { MAX: 5 },
  getPermissionsAsync: mocks.getPermission,
  requestPermissionsAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
  setBadgeCountAsync: vi.fn(async () => true),
  getLastNotificationResponseAsync: vi.fn(async () => null),
  addNotificationReceivedListener: () => ({ remove: vi.fn() }),
  addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
}));
vi.mock("@/utils/devicePrefs", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    DevicePrefs: {
      ensure: () => mocks.prefs,
      update: (updates: typeof mocks.prefs) => {
        mocks.prefs = { ...mocks.prefs, ...updates };
        mocks.prefsListeners.forEach((listener) => {
          listener();
        });
      },
    },
    useDevicePrefs: () =>
      useSyncExternalStore(
        (listener) => {
          mocks.prefsListeners.add(listener);
          return () => mocks.prefsListeners.delete(listener);
        },
        () => mocks.prefs,
      ),
  };
});
vi.mock("@/utils/pushTokens", () => ({
  PushTokens: { updatePushTokens: mocks.register },
}));
vi.mock("@/utils/sentry", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/utils/statsig", () => ({ statsig: { logEvent: vi.fn() } }));
vi.mock("@/ui/toast/Toast", () => ({ toast: { notification: vi.fn() } }));
vi.mock("@/utils/scheduleIdleTask", () => ({
  scheduleIdleTask: (task: () => void) => {
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) {
        task();
      }
    });
    return {
      cancel: () => {
        canceled = true;
      },
    };
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const granted = { status: "granted", granted: true, canAskAgain: true };
let renderer: ReactTestRenderer | undefined;
function Harness() {
  return createElement("PushState", usePushNotifications());
}
function state(): PushNotificationState {
  if (!renderer) {
    throw new Error("Hook is not mounted");
  }
  return renderer.root.findByType("PushState" as never)
    .props as PushNotificationState;
}
async function render() {
  await act(async () => {
    const element = createElement(StrictMode, null, createElement(Harness));
    if (renderer) {
      renderer.update(element);
    } else {
      renderer = create(element);
    }
  });
}
async function changeAppState(state: string) {
  await act(async () => {
    mocks.appListeners.forEach((listener) => {
      listener(state);
    });
  });
}
const foreground = () => changeAppState("active");
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const settle = () => advance(PUSH_REGISTRATION_SETTLE_MS);
function unmount() {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mocks.user = {
    uid: "user-1",
    email: "member@example.com",
    isAnonymous: false,
  };
  mocks.authenticatedUid = "user-1";
  mocks.prefs = {};
  mocks.getPermission.mockResolvedValue(granted);
  mocks.getFcmToken.mockResolvedValue("fcm-token");
  mocks.register.mockResolvedValue({ status: "confirmed" });
});
afterEach(() => {
  unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("waits for the app to settle before registering", async () => {
  await render();
  await advance(PUSH_REGISTRATION_SETTLE_MS - 1);
  expect(mocks.getFcmToken).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
  await advance(1);
  expect(mocks.register).toHaveBeenCalledOnce();
});

test("drops a pending registration when backgrounded and waits again after resume", async () => {
  await render();
  await advance(PUSH_REGISTRATION_SETTLE_MS - 1_000);
  await changeAppState("background");
  await advance(60_000);
  expect(mocks.getFcmToken).not.toHaveBeenCalled();
  await foreground();
  await advance(PUSH_REGISTRATION_SETTLE_MS - 1);
  expect(mocks.getFcmToken).not.toHaveBeenCalled();
  await advance(1);
  expect(mocks.register).toHaveBeenCalledOnce();
});

test("registers once for changes made while the app settles", async () => {
  await render();
  await advance(PUSH_REGISTRATION_SETTLE_MS - 1_000);
  mocks.getFcmToken.mockResolvedValue("rotated-token");
  await act(async () => {
    mocks.tokenListeners.forEach((listener) => {
      listener();
    });
  });
  await advance(PUSH_REGISTRATION_SETTLE_MS - 1);
  expect(mocks.register).not.toHaveBeenCalled();
  await advance(1);
  expect(mocks.register).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ fcmToken: "rotated-token" }),
  );
});

test("waits for the matching Relay authentication scope", async () => {
  mocks.authenticatedUid = undefined;
  await render();
  await settle();
  expect(mocks.register).not.toHaveBeenCalled();
  mocks.authenticatedUid = "user-1";
  await render();
  await settle();
  expect(mocks.register).toHaveBeenCalledOnce();
});

test("a sign-out while fetching tokens cannot upload the old registration", async () => {
  let resolve!: (token: string) => void;
  mocks.getFcmToken.mockReturnValueOnce(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  await render();
  await settle();
  expect(state().isRegistering).toBe(true);
  mocks.user = null;
  mocks.authenticatedUid = undefined;
  await render();
  await act(async () => {
    resolve("old-token");
  });
  expect(mocks.register).not.toHaveBeenCalled();
  expect(state().isRegistering).toBe(false);
});

test("keeps the complete desired subscriptions on foreground and token rotation", async () => {
  const subscriptions = {
    channels: ["events", "news"],
    preferredCampus: { version: 3 },
  };
  const refresh = vi.fn();
  const hook = vi
    .spyOn(subscriptionHook, "usePushSubscriptions")
    .mockReturnValue({ subscriptions, isReady: false, refresh });
  await render();
  await settle();
  expect(mocks.register).not.toHaveBeenCalled();
  hook.mockReturnValue({ subscriptions, isReady: true, refresh });
  await render();
  await settle();
  expect(mocks.register).toHaveBeenLastCalledWith({
    fcmToken: "fcm-token",
    subscriptions,
  });
  await foreground();
  await settle();
  expect(mocks.register).toHaveBeenLastCalledWith({
    fcmToken: "fcm-token",
    subscriptions,
  });
  mocks.getFcmToken.mockResolvedValue("rotated-token");
  await act(async () => {
    mocks.tokenListeners.forEach((listener) => {
      listener();
    });
  });
  await settle();
  expect(mocks.register).toHaveBeenLastCalledWith({
    fcmToken: "rotated-token",
    subscriptions,
  });
  expect(refresh).toHaveBeenCalled();
});

test("registers after a transient FCM failure without reporting a recovered error", async () => {
  mocks.getFcmToken.mockRejectedValueOnce(
    Object.assign(new Error("The network connection was lost."), {
      code: "messaging/unknown",
    }),
  );
  await render();
  await settle();
  expect(mocks.register).not.toHaveBeenCalled();
  await advance(1_000);
  expect(mocks.register).toHaveBeenCalledOnce();
  expect(captureException).not.toHaveBeenCalled();
  expect(state().isRegistering).toBe(false);
});

test.each(["foreground", "connectivity"])(
  "defers exhausted network failures and registers on the next %s refresh",
  async (trigger) => {
    mocks.getFcmToken.mockRejectedValue(
      Object.assign(new Error("The network connection was lost."), {
        code: "messaging/unknown",
        nativeErrorCode: -1005,
      }),
    );
    await render();
    await settle();
    await advance(7_000);
    expect(mocks.getFcmToken).toHaveBeenCalledTimes(4);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(state().isRegistering).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledOnce();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warning" }),
    );

    mocks.getFcmToken.mockResolvedValue("recovered-token");
    if (trigger === "foreground") {
      await foreground();
    } else {
      await act(async () => {
        mocks.connectivityListeners.forEach((listener) => {
          listener();
        });
      });
    }
    await settle();
    expect(mocks.getFcmToken).toHaveBeenCalledTimes(5);
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith({
      fcmToken: "recovered-token",
      subscriptions: {
        channels: [
          "notify-prefs-v1",
          "verse-of-the-day",
          "livestreams",
          "word-of-activation",
        ],
        preferredCampus: { version: 0 },
      },
    });
    expect(state().isRegistering).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
  },
);

test("still reports permanent token acquisition failures", async () => {
  const error = Object.assign(new Error("Invalid sender"), {
    code: "messaging/unknown",
  });
  mocks.getFcmToken.mockRejectedValue(error);
  await render();
  await settle();
  expect(mocks.getFcmToken).toHaveBeenCalledOnce();
  expect(mocks.register).not.toHaveBeenCalled();
  expect(state().isRegistering).toBe(false);
  expect(captureException).toHaveBeenCalledExactlyOnceWith(error);
  expect(addBreadcrumb).not.toHaveBeenCalled();
});

test("cancels token retries on unmount", async () => {
  mocks.getFcmToken.mockRejectedValueOnce(
    Object.assign(new Error("The network connection was lost."), {
      code: "messaging/unknown",
    }),
  );
  await render();
  await settle();
  unmount();
  await advance(10_000);
  expect(mocks.getFcmToken).toHaveBeenCalledOnce();
  expect(mocks.register).not.toHaveBeenCalled();
  expect(captureException).not.toHaveBeenCalled();
});
