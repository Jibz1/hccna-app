import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";

import type { PushSubscriptions } from "@/utils/pushSubscriptions";

import { usePushSubscriptions } from "./usePushSubscriptions";

const mocks = vi.hoisted(() => ({ enabled: true }));

vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: null }),
}));
vi.mock("jotai", () => ({ useAtomValue: () => null }));
vi.mock("@/environment", () => ({ environmentAtom: {} }));
vi.mock("@/hooks/relay/usePreferredCampus", () => ({
  usePreferredCampus: () => ({ isLoaded: true, version: 3 }),
}));
vi.mock("@/hooks/relay/useUserData", () => ({
  fetchUserProfileQuery: vi.fn(),
  recordUserDataQueryRefresh: vi.fn(),
  shouldRefreshUserDataQuery: vi.fn(),
}));
vi.mock("@/hooks/utils/useNotificationSettingsEnabled", () => ({
  useNotificationSettingsEnabled: () => mocks.enabled,
}));
vi.mock("@/utils/devicePrefs", () => ({
  useDevicePrefs: () => ({ notificationCategoriesOff: ["livestreams"] }),
}));
vi.mock("@/utils/pushTokenAuth", () => ({ getPushTokenRelayScope: vi.fn() }));
vi.mock("@/utils/sentry", () => ({ captureException: vi.fn() }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  return createElement("output", {
    subscriptions: usePushSubscriptions().subscriptions,
  });
}

async function subscriptions(): Promise<PushSubscriptions> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  const value = renderer!.root.findByType("output" as never).props
    .subscriptions as PushSubscriptions;
  act(() => {
    renderer?.unmount();
  });
  return value;
}

test("registers saved notification choices while the gate is on", async () => {
  mocks.enabled = true;

  expect(await subscriptions()).toEqual({
    channels: ["notify-prefs-v1", "verse-of-the-day", "word-of-activation"],
    preferredCampus: { version: 3 },
  });
});

test("registers no notification choices while the gate is off", async () => {
  mocks.enabled = false;

  expect(await subscriptions()).toEqual({
    channels: [],
    preferredCampus: { version: 3 },
  });
});
