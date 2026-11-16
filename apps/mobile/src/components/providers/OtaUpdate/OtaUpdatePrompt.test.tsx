import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ForceUpdateOverlay } from "@/components/providers/ForceUpdate/ForceUpdateOverlay";

import { OtaUpdatePrompt } from "./OtaUpdatePrompt";

const state = vi.hoisted(() => ({
  isEnabled: true,
  updates: {
    isUpdatePending: true,
    downloadedUpdate: { type: "new" },
  },
  reloadAsync: vi.fn(() => Promise.resolve()),
  captureException: vi.fn(),
}));

vi.mock("expo-updates", () => ({
  get isEnabled() {
    return state.isEnabled;
  },
  useUpdates: () => state.updates,
  reloadAsync: state.reloadAsync,
}));
vi.mock("@/components/providers/ForceUpdate/ForceUpdateOverlay", () => ({
  ForceUpdateOverlay: (props: ComponentProps<typeof ForceUpdateOverlay>) =>
    createElement("Overlay", props),
}));
vi.mock("@/utils/sentry", () => ({ captureException: state.captureException }));

let renderer: ReactTestRenderer | undefined;

function render() {
  act(() => {
    renderer = create(createElement(OtaUpdatePrompt));
  });
  return renderer!;
}

const overlay = () => renderer!.root.findAllByType("Overlay" as never)[0];

beforeEach(() => {
  state.isEnabled = true;
  state.updates = { isUpdatePending: true, downloadedUpdate: { type: "new" } };
  state.reloadAsync.mockClear();
  state.reloadAsync.mockImplementation(() => Promise.resolve());
  state.captureException.mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("offers a restart in the soft update layout once a new update is ready", () => {
  render();
  expect(overlay().props).toMatchObject({
    updateType: "soft",
    config: {
      title: "An update is ready",
      updateButtonText: "Restart now",
      dismissButtonText: "Later",
    },
    actionIcon: "rotate-right",
    readyNote: null,
    footnote: "Otherwise it installs the next time you open HCC.",
  });
});

test("Restart now launches the downloaded update", () => {
  render();
  act(() => {
    overlay().props.onUpdate();
  });
  expect(state.reloadAsync).toHaveBeenCalledTimes(1);
});

test("Later hides the prompt for the session", () => {
  render();
  act(() => {
    overlay().props.onDismiss();
  });
  expect(renderer!.root.findAllByType("Overlay" as never)).toHaveLength(0);
});

test("a failed restart is reported and closes the prompt until the next launch", async () => {
  const failure = new Error("reload failed");
  state.reloadAsync.mockImplementation(() => Promise.reject(failure));
  render();
  await act(async () => {
    overlay().props.onUpdate();
  });
  expect(renderer!.root.findAllByType("Overlay" as never)).toHaveLength(0);
  expect(state.captureException).toHaveBeenCalledWith(failure);
});

test("renders nothing for a rollback directive", () => {
  state.updates = {
    isUpdatePending: true,
    downloadedUpdate: { type: "rollback" },
  };
  render();
  expect(renderer!.root.findAllByType("Overlay" as never)).toHaveLength(0);
});
