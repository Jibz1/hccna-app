import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useLogoutMutation } from "./useLogoutMutation";

const mocks = vi.hoisted(() => ({
  currentUser: null as null | {
    uid: string;
    isAnonymous: boolean;
    providerId: string;
    providerData: { providerId: string }[];
  },
  signOut: vi.fn(),
}));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: mocks.currentUser }),
}));
vi.mock("@/utils/auth", () => ({
  Auth: { signOutFromProvider: mocks.signOut },
}));
vi.mock("@/utils/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/utils/statsig", () => ({ statsig: { logEvent: vi.fn() } }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useLogoutMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue(undefined);
  });
  it.each([
    ["google.com", "google"],
    ["apple.com", "apple"],
    ["password", "firebase"],
  ])("signs out %s without a backend profile", async (providerId, expected) => {
    mocks.currentUser = {
      uid: "user",
      isAnonymous: false,
      providerId: "firebase",
      providerData: [{ providerId }],
    };
    function Probe() {
      const { mutateAsync } = useLogoutMutation();
      return createElement("button", { onClick: () => mutateAsync() });
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(Probe));
    });
    await act(async () => {
      await renderer.root.findByType("button").props.onClick();
    });
    expect(mocks.signOut).toHaveBeenCalledWith(expected, "user");
    await act(async () => {
      renderer.unmount();
    });
  });
});
