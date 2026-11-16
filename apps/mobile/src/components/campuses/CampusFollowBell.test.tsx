import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { DevicePrefsDoc } from "@/utils/devicePrefsSchema";

import { CampusFollowBell } from "./CampusFollowBell";

type Prefs = Pick<
  DevicePrefsDoc,
  "notificationCategoriesOff" | "followedCampusSlugs"
>;

const mocks = vi.hoisted(() => ({
  prefs: {} as Prefs,
  permission: { granted: true, canAskAgain: true },
  request: vi.fn(),
  openSettings: vi.fn(async () => undefined),
  success: vi.fn(),
  enabled: true,
}));

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("@/hooks/utils/useNotificationSettingsEnabled", () => ({
  useNotificationSettingsEnabled: () => mocks.enabled,
}));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => mocks.permission,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Pressable: "Pressable",
}));
vi.mock("@/components/notifications/PushNotificationPrompt", () => ({
  NotificationPromptSheet: "Sheet",
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: {} }),
}));
vi.mock("@/ui/toast/Toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@/utils/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/utils/openPermissionSettings", () => ({
  openPermissionSettings: mocks.openSettings,
}));
vi.mock("@/utils/notificationPermission", () => ({
  hasNotificationPermission: (permission: { granted: boolean }) =>
    permission.granted,
  requestNotificationPermission: mocks.request,
}));
vi.mock("@/utils/devicePrefs", async () => {
  const { useSyncExternalStore } = await import("react");
  const listeners = new Set<() => void>();
  return {
    DevicePrefs: {
      update: (updates: Prefs) => {
        mocks.prefs = { ...mocks.prefs, ...updates };
        listeners.forEach((listener) => {
          listener();
        });
      },
    },
    useDevicePrefs: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => mocks.prefs,
      ),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

async function render(isOwnCampus: boolean) {
  await act(async () => {
    renderer = create(
      createElement(CampusFollowBell, {
        campusSlug: "new-breed",
        campusName: "New Breed",
        isOwnCampus,
      }),
    );
  });
  return renderer!;
}

const bell = (screen: ReactTestRenderer) =>
  screen.root.findByProps({ accessibilityRole: "switch" });
const sheet = (screen: ReactTestRenderer) =>
  screen.root.findByType("Sheet" as never);

async function press(screen: ReactTestRenderer) {
  await act(async () => {
    bell(screen).props.onPress();
  });
}

beforeEach(() => {
  mocks.enabled = true;
  mocks.prefs = {};
  mocks.permission = { granted: true, canAskAgain: true };
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("follows another campus's livestreams on this device", async () => {
  const screen = await render(false);
  expect(bell(screen).props.accessibilityState).toEqual({ checked: false });

  await press(screen);

  expect(mocks.prefs.followedCampusSlugs).toEqual(["new-breed"]);
  expect(bell(screen).props.accessibilityState).toEqual({ checked: true });
  expect(mocks.success).toHaveBeenCalledOnce();
  expect(sheet(screen).props.showPrompt).toBe(false);
});

test("turns the Livestreams category off and on for the device's own campus", async () => {
  const screen = await render(true);
  expect(bell(screen).props.accessibilityState).toEqual({ checked: true });

  await press(screen);
  expect(mocks.prefs.notificationCategoriesOff).toEqual(["livestreams"]);

  await press(screen);
  expect(mocks.prefs.notificationCategoriesOff).toEqual([]);
  expect(mocks.prefs.followedCampusSlugs).toEqual([]);
});

test("turning the own campus off also drops a follow kept from before it became the campus", async () => {
  mocks.prefs = { followedCampusSlugs: ["light-house", "new-breed"] };
  const screen = await render(true);
  expect(bell(screen).props.accessibilityState).toEqual({ checked: true });

  await press(screen);

  expect(bell(screen).props.accessibilityState).toEqual({ checked: false });
  expect(mocks.prefs.notificationCategoriesOff).toEqual(["livestreams"]);
  expect(mocks.prefs.followedCampusSlugs).toEqual(["light-house"]);
});

test("points each prompt at the control that can undo it", async () => {
  mocks.permission = { granted: false, canAskAgain: true };
  const other = await render(false);
  await press(other);
  expect(sheet(other).props.message).toBe(
    "Tap the bell again anytime to stop these alerts.",
  );
  act(() => {
    other.unmount();
  });

  mocks.prefs = { notificationCategoriesOff: ["livestreams"] };
  const own = await render(true);
  await press(own);
  expect(sheet(own).props.message).toBe(
    "You can change this anytime in Settings → Notifications.",
  );
});

test("asks for permission in context before confirming the follow", async () => {
  mocks.permission = { granted: false, canAskAgain: true };
  mocks.request.mockResolvedValue({ granted: true, canAskAgain: true });
  const screen = await render(false);

  await press(screen);
  expect(sheet(screen).props.showPrompt).toBe(true);
  expect(sheet(screen).props.confirmLabel).toBe("Turn on");
  expect(mocks.success).not.toHaveBeenCalled();

  await act(async () => {
    await sheet(screen).props.requestNotifications();
  });
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(sheet(screen).props.showPrompt).toBe(false);
  expect(mocks.success).toHaveBeenCalledOnce();
});

test("sends people to Settings when the system prompt can't be shown again", async () => {
  mocks.permission = { granted: false, canAskAgain: false };
  const screen = await render(false);

  await press(screen);
  expect(sheet(screen).props.confirmLabel).toBe("Open Settings");

  await act(async () => {
    await sheet(screen).props.requestNotifications();
  });
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.openSettings).toHaveBeenCalledWith("notifications");
  expect(mocks.prefs.followedCampusSlugs).toEqual(["new-breed"]);
});

test("hides the bell while the notification settings gate is off", async () => {
  mocks.enabled = false;
  const screen = await render(false);

  expect(screen.toJSON()).toBeNull();
});
