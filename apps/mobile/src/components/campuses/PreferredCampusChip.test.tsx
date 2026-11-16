import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { PreferredCampusChip } from "./PreferredCampusChip";

const mocks = vi.hoisted(() => ({
  save: vi.fn<(slug: string, version: number) => Promise<void>>(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  View: "View",
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: { accent: "#995234" } }),
}));
vi.mock("@/hooks/profile/useSavePreferredCampus", () => ({
  useSavePreferredCampus: () => ({ save: mocks.save, isSaving: false }),
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("@/ui/toast/Toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
let preferredCampus: ComponentProps<
  typeof PreferredCampusChip
>["preferredCampus"];
let isPreferred = false;

function render() {
  act(() => {
    const button = createElement(PreferredCampusChip, {
      campusSlug: "new-breed",
      campusName: "New Breed",
      isPreferred,
      preferredCampus,
    });
    if (renderer) {
      renderer.update(button);
    } else {
      renderer = create(button);
    }
  });
}

function press() {
  renderer!.root.findByProps({ accessibilityRole: "button" }).props.onPress();
}

beforeEach(() => {
  vi.clearAllMocks();
  isPreferred = false;
  mocks.save.mockReset().mockResolvedValue();
  preferredCampus = {
    slug: "house-of-stars",
    campusName: "House of Stars",
    hasSavedCampus: true,
    isAuthenticated: true,
    isLoaded: true,
    version: 2,
  };
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("shows the save error and allows a retry with the current preference version", async () => {
  const pending = Promise.withResolvers<void>();
  mocks.save.mockReturnValueOnce(pending.promise);
  render();
  act(() => {
    press();
    press();
  });
  await act(async () => {
    pending.reject(new Error("Your campus changed on another device."));
  });
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith({
    title: "Couldn't save your campus",
    message: "Your campus changed on another device.",
  });
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledTimes(1);

  preferredCampus = { ...preferredCampus, version: 3 };
  render();
  await act(async () => {
    press();
  });
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenLastCalledWith("new-breed", 3);
  expect(mocks.success).toHaveBeenCalledOnce();
});

test("shows the chosen campus as a status without a save action", () => {
  isPreferred = true;
  render();
  expect(
    renderer!.root.findAllByProps({ accessibilityRole: "button" }),
  ).toHaveLength(0);
  expect(
    renderer!.root.findByProps({ accessibilityRole: "text" }).props
      .accessibilityLabel,
  ).toBe("My campus");
});
