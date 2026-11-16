import { beforeEach, expect, test, vi } from "vitest";

import { currentAppState } from "@/utils/appState";

const { AppState } = vi.hoisted(() => ({
  AppState: { currentState: null as string | null | undefined },
}));

vi.mock("react-native", () => ({ AppState }));

beforeEach(() => {
  AppState.currentState = null;
});

test.each(["active", "background", "inactive", "extension", "unknown"])(
  "reports the native %s state",
  (state) => {
    AppState.currentState = state;
    expect(currentAppState()).toBe(state);
  },
);

test.each([null, undefined, "suspended"])("reports %s as unknown", (state) => {
  AppState.currentState = state;
  expect(currentAppState()).toBe("unknown");
});
