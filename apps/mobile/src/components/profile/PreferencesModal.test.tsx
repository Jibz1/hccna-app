import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { PreferencesModal } from "./PreferencesModal";

const state = vi.hoisted(() => ({
  slug: "house-of-stars",
  hasSavedCampus: true,
  isAuthenticated: true,
  isLoaded: true,
  version: 2,
  isSaving: false,
  save: vi.fn(() => Promise.resolve()),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchPolicy: "store-or-network",
  hasCachedCampuses: true,
  update: vi.fn(),
  goBackOrReplace: vi.fn(),
  push: vi.fn(),
  useCampuses: vi.fn(() => [
    { slug: "house-of-stars", campusName: "House of Stars" },
    { slug: "union", campusName: "Union Campus" },
  ]),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: "View",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
}));
vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/cssInterop", () => ({
  StyledImage: "Image",
  StyledLinearGradient: "Gradient",
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({
    colors: { text: "#342B27", accent: "#995234" },
    backgroundGradient: [],
    backgroundGradientLocations: [],
  }),
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("@/ui/Card", () => ({ Card: "Card" }));
vi.mock("@/ui/toast/Toast", () => ({
  toast: { success: state.toastSuccess, error: state.toastError },
}));
vi.mock("@/components/layout/FullLoadingState", () => ({
  FullLoadingState: "FullLoadingState",
}));
vi.mock("@/components/campuses/CampusesUnavailable", () => ({
  CampusesUnavailable: "CampusesUnavailable",
}));
vi.mock("@/components/providers/ErrorBoundaryWithRetry", () => ({
  ErrorBoundaryWithRetry: ({ children }: { children: ReactNode }) => children,
  useRetryKey: () => "retry-0",
}));
vi.mock("@/hooks/relay/usePreferredCampus", () => ({
  usePreferredCampus: () => state,
}));
vi.mock("@/hooks/relay/useCampuses", () => ({
  useCampuses: state.useCampuses,
  useHasCachedCampuses: () => state.hasCachedCampuses,
}));
vi.mock("@/hooks/relay/useConnectivityAwareFetchPolicy", () => ({
  useConnectivityAwareFetchPolicy: () => state.fetchPolicy,
}));
vi.mock("@/hooks/profile/useSavePreferredCampus", () => ({
  useSavePreferredCampus: () => ({
    save: state.save,
    isSaving: state.isSaving,
  }),
}));
vi.mock("@/utils/devicePrefs", () => ({
  DevicePrefs: { update: state.update },
}));
vi.mock("@/utils/navigation", () => ({
  goBackOrReplace: state.goBackOrReplace,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
function render() {
  act(() => {
    renderer = create(createElement(PreferencesModal));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.hasSavedCampus = true;
});
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
});

function press(label: string) {
  act(() => {
    renderer!.root.findByProps({ accessibilityLabel: label }).props.onPress();
  });
}

function deferredSave() {
  const pending = Promise.withResolvers<void>();
  state.save.mockReturnValueOnce(pending.promise);
  return pending;
}

function closeModal() {
  act(() => {
    renderer!.unmount();
  });
  renderer = undefined;
}

test("reports a failed save after unmount and retains the confirmed preference", async () => {
  const pending = deferredSave();
  render();
  press("Union Campus");
  press("Save campus");
  expect(state.goBackOrReplace).toHaveBeenCalledWith("/profile");
  closeModal();
  await act(async () => {
    pending.reject(new Error("Check your connection and try again."));
  });
  expect(state.toastError).toHaveBeenCalledExactlyOnceWith({
    title: "Couldn't save your campus",
    message: "Check your connection and try again.",
  });
  expect(state.toastSuccess).not.toHaveBeenCalled();
  render();
  expect(
    renderer!.root.findByProps({ accessibilityLabel: "House of Stars" }).props
      .accessibilityState.checked,
  ).toBe(true);
});

test("allows a first-time preference to save the default campus", async () => {
  state.hasSavedCampus = false;
  render();
  expect(
    renderer!.root.findByProps({ accessibilityLabel: "Save campus" }).props
      .disabled,
  ).toBe(false);

  await act(async () => {
    press("Save campus");
  });
  expect(state.save).toHaveBeenCalledExactlyOnceWith("house-of-stars", 2);
  expect(state.goBackOrReplace).toHaveBeenCalledWith("/profile");
});

test("keeps Save disabled when the selected campus is already saved", () => {
  render();
  expect(
    renderer!.root.findByProps({ accessibilityLabel: "Save campus" }).props
      .disabled,
  ).toBe(true);
  press("Save campus");
  expect(state.save).not.toHaveBeenCalled();
});
