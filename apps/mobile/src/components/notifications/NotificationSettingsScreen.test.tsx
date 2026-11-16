import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { DevicePrefsDoc } from "@/utils/devicePrefsSchema";

import { NotificationSettingsScreen } from "./NotificationSettingsScreen";

type Prefs = Pick<DevicePrefsDoc, "notificationCategoriesOff">;

const mocks = vi.hoisted(() => ({
  prefs: {} as Prefs,
  permission: { granted: true, canAskAgain: true, status: "granted" },
  request: vi.fn(),
  openSettings: vi.fn(async () => undefined),
  enabled: true,
}));

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("@/hooks/utils/useNotificationSettingsEnabled", () => ({
  useNotificationSettingsEnabled: () => mocks.enabled,
}));
vi.mock("expo-router", () => ({
  Redirect: "Redirect",
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = require("react") as typeof import("react");
    useEffect(effect, [effect]);
  },
}));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => mocks.permission,
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  Switch: "Switch",
  View: "View",
}));
vi.mock("@/components/layout/DetailModalLayout", () => ({
  DetailModalLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/more/MoreSection", () => ({
  MoreSection: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: {}, isDark: false }),
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("@/ui/toast/Toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/utils/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/utils/openPermissionSettings", () => ({
  openPermissionSettings: mocks.openSettings,
}));
vi.mock("@/utils/notificationPermission", () => ({
  hasNotificationPermission: (permission: { granted: boolean }) =>
    permission.granted,
  requestNotificationPermission: mocks.request,
}));
vi.mock("@/utils/devicePrefs", () => ({
  DevicePrefs: {
    update: (updates: typeof mocks.prefs) => {
      mocks.prefs = { ...mocks.prefs, ...updates };
    },
  },
  useDevicePrefs: () => mocks.prefs,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

async function render() {
  await act(async () => {
    renderer = create(createElement(NotificationSettingsScreen));
  });
  return renderer!;
}

const switchFor = (screen: ReactTestRenderer, label: string) =>
  screen.root.findByProps({ accessibilityLabel: label });

beforeEach(() => {
  mocks.enabled = true;
  mocks.prefs = {};
  mocks.permission = { granted: true, canAskAgain: true, status: "granted" };
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("turning a category off saves it for this device", async () => {
  const screen = await render();

  expect(switchFor(screen, "Livestreams").props.value).toBe(true);
  await act(async () => {
    switchFor(screen, "Livestreams").props.onValueChange(false);
  });

  expect(mocks.prefs.notificationCategoriesOff).toEqual(["livestreams"]);
});

test("asks for permission when notifications have not been allowed yet", async () => {
  mocks.permission = {
    granted: false,
    canAskAgain: true,
    status: "undetermined",
  };
  mocks.request.mockResolvedValue({ ...mocks.permission, granted: true });
  const screen = await render();

  expect(switchFor(screen, "Livestreams").props.disabled).toBe(true);
  await act(async () =>
    screen.root.findByProps({ accessibilityRole: "button" }).props.onPress(),
  );

  expect(mocks.request).toHaveBeenCalledOnce();
  expect(switchFor(screen, "Livestreams").props.disabled).toBe(false);
});

test("sends people to Settings once the system prompt can't be shown again", async () => {
  mocks.permission = { granted: false, canAskAgain: false, status: "denied" };
  const screen = await render();

  await act(async () =>
    screen.root.findByProps({ accessibilityRole: "button" }).props.onPress(),
  );

  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.openSettings).toHaveBeenCalledWith("notifications");
});

test("leaves the screen while the notification settings gate is off", async () => {
  mocks.enabled = false;
  const screen = await render();

  expect(screen.root.findByType("Redirect" as never).props.href).toBe("/");
  expect(
    screen.root.findAllByProps({ accessibilityLabel: "Livestreams" }),
  ).toEqual([]);
});
