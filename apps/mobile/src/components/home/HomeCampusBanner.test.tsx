import { createStore, Provider } from "jotai";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HomeCampusBanner } from "./HomeCampusBanner";

const state = vi.hoisted(() => ({
  uid: "user-1" as string | undefined,
  profile: null as { preferredCampusSlug: string | null } | null,
  navigate: vi.fn(),
}));

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ navigate: state.navigate }),
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("@/hooks/relay/useUserData", () => ({
  useAuthenticatedUid: () => state.uid,
  useUserProfile: () => state.profile,
}));
vi.mock("@/hooks/relay/useCampuses", () => ({
  useCachedCampuses: () => [],
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: { accent: "#995234", textMuted: "#756358" } }),
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
let store: ReturnType<typeof createStore>;

function render() {
  act(() => {
    const banner = createElement(
      Provider,
      { store },
      createElement(HomeCampusBanner),
    );
    if (renderer) {
      renderer.update(banner);
    } else {
      renderer = create(banner);
    }
  });
}

function press(accessibilityLabel: string) {
  act(() => {
    renderer!.root.findByProps({ accessibilityLabel }).props.onPress();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createStore();
  state.uid = "user-1";
  state.profile = { preferredCampusSlug: null };
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("opens campus preferences and disappears when the default campus is saved", () => {
  render();
  expect(renderer!.root.findByProps({ children: "Next steps" }).type).toBe(
    "Text",
  );
  expect(renderer!.root.findByProps({ children: "Choose a campus" }).type).toBe(
    "Text",
  );
  expect(
    renderer!.root.findAllByProps({
      children: "Find your events, livestreams, and giving.",
    }),
  ).toHaveLength(0);

  press("Next steps: Choose a campus");
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith("/preferences");

  state.profile = { preferredCampusSlug: "house-of-stars" };
  render();
  expect(renderer!.toJSON()).toBeNull();
});

test("dismissing hides the prompt for that user without opening preferences", () => {
  render();
  press("Dismiss campus reminder");
  expect(state.navigate).not.toHaveBeenCalled();
  expect(renderer!.toJSON()).toBeNull();

  state.uid = "user-2";
  render();
  expect(renderer!.toJSON()).not.toBeNull();
});

test("remembers every account that dismissed the prompt during this launch", () => {
  render();
  press("Dismiss campus reminder");

  state.uid = "user-2";
  render();
  press("Dismiss campus reminder");

  state.uid = "user-1";
  render();
  expect(renderer!.toJSON()).toBeNull();
});

test("waits for the signed-in user's profile before prompting", () => {
  state.profile = null;
  render();
  expect(renderer!.toJSON()).toBeNull();

  state.profile = { preferredCampusSlug: null };
  render();
  expect(renderer!.toJSON()).not.toBeNull();
});

test("hides the prompt after sign-out even if profile data remains cached", () => {
  render();
  expect(renderer!.toJSON()).not.toBeNull();

  state.uid = undefined;
  render();
  expect(renderer!.toJSON()).toBeNull();
});
