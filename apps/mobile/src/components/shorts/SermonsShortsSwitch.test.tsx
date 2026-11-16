import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";

import { SermonsShortsSwitch } from "./SermonsShortsSwitch";

vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

function render(props: Parameters<typeof SermonsShortsSwitch>[0]) {
  act(() => {
    renderer = create(createElement(SermonsShortsSwitch, props));
  });
}

const segment = (label: string) =>
  renderer!.root.findByProps({ accessibilityLabel: label });

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("marks the current mode selected", () => {
  render({ value: "shorts", onChange: vi.fn() });

  expect(
    renderer!.root.findAllByProps({ accessibilityRole: "tablist" }),
  ).toHaveLength(1);
  expect(segment("Shorts").props.accessibilityRole).toBe("tab");
  expect(segment("Shorts").props.accessibilityState).toEqual({
    selected: true,
  });
  expect(segment("Sermons").props.accessibilityState).toEqual({
    selected: false,
  });
});

test("reports the other mode when pressed", () => {
  const onChange = vi.fn();
  render({ value: "sermons", onChange });

  act(() => {
    segment("Shorts").props.onPress();
  });

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith("shorts");
});

test("does not report a press on the selected segment", () => {
  const onChange = vi.fn();
  render({ value: "sermons", onChange });

  act(() => {
    segment("Sermons").props.onPress();
  });

  expect(onChange).not.toHaveBeenCalled();
});
