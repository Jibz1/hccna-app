import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import DeleteAccountConfirmationScreen from "@/app/delete-account-confirmation";
import { OtpInput } from "@/ui/OtpInput";

type TestPrefs = {
  deleteAccountRequest: { email: string; expiresTimestampMs: number } | null;
};

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  verify: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  update: vi.fn(),
  success: vi.fn(),
  email: "member@example.com" as string | null,
  prefs: { deleteAccountRequest: null } as TestPrefs,
  listeners: new Set<() => void>(),
}));
vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("react-native", () => ({
  View: "View",
  Pressable: "Pressable",
  ActivityIndicator: "ActivityIndicator",
}));
vi.mock("expo-router", () => ({ router: { replace: mocks.replace } }));
vi.mock("@/components/auth/DeleteAccountLayout", () => ({
  DeleteAccountLayout: "Layout",
  KeepAccountAction: "KeepAccountAction",
}));
vi.mock("@/components/auth/SignInAction", () => ({
  SignInAction: "SignInAction",
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({
    colors: { textMuted: "gray", accent: "brown", background: "white" },
    isDark: false,
  }),
}));
vi.mock("@/components/events/CountDownTimer", () => ({
  CountDownTimer: "CountDownTimer",
}));
vi.mock("@/hooks/auth/useRequestDeleteAccount", () => ({
  useRequestDeleteAccount: () => ({ requestDeleteAccount: mocks.request }),
}));
vi.mock("@/hooks/auth/useDeleteAccountConfirmation", () => ({
  useVerifyDeleteAccountCodeMutation: () => ({ mutateAsync: mocks.verify }),
}));
vi.mock("@/hooks/relay/useUserData", () => ({
  useUserProfile: () => (mocks.email ? { email: mocks.email } : null),
}));
vi.mock("@/ui/OtpInput", () => ({ OtpInput: "OtpInput" }));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("@/ui/toast/Toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@/utils/navigation", () => ({ goBackOrReplace: mocks.back }));
vi.mock("@/utils/devicePrefs", () => ({
  DevicePrefs: {
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
    getSnapshot: () => mocks.prefs,
    update: mocks.update,
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
function render() {
  act(() => {
    renderer = create(createElement(DeleteAccountConfirmationScreen));
  });
}
function enterCode() {
  act(() => {
    renderer.root.findByType(OtpInput).props.onChange("123456");
  });
}
function deleteButton() {
  return renderer.root.findByProps({ accessibilityLabel: "Delete my account" });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T18:00:00Z"));
  vi.resetAllMocks();
  mocks.email = "member@example.com";
  mocks.prefs = {
    deleteAccountRequest: {
      email: mocks.email,
      expiresTimestampMs: Date.now() + 600_000,
    },
  };
  mocks.verify.mockResolvedValue({
    verifyDeleteAccountCode: { success: true },
  });
  mocks.update.mockImplementation((updates) => {
    mocks.prefs = { ...mocks.prefs, ...updates };
    mocks.listeners.forEach((listener) => {
      listener();
    });
  });
});
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  vi.useRealTimers();
});

test("entering all six digits never deletes until the user presses Delete my account", async () => {
  render();
  expect(deleteButton().props.disabled).toBe(true);
  enterCode();
  expect(renderer.root.findByType(OtpInput).props.onComplete).toBeUndefined();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(deleteButton().props.disabled).toBe(false);
  await act(async () => {
    deleteButton().props.onPress();
  });
  expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ code: "123456" });
  expect(mocks.back).toHaveBeenCalledWith("/profile");
  expect(mocks.prefs.deleteAccountRequest).toBeNull();
});
