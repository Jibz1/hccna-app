import { createRef, StrictMode } from "react";
import type { TextInputInstance } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { BaseInput } from "./BaseInput";

vi.mock("react-native-gesture-handler", () => ({ TextInput: "TextInput" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
const input = { focus: vi.fn(), isFocused: vi.fn(() => false) };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
  input.focus.mockClear();
  input.isFocused.mockReturnValue(false);
});

afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("defers autofocus and preserves the caller's ref through Strict Mode", () => {
  const ref = createRef<TextInputInstance>();
  act(() => {
    renderer = create(
      <StrictMode>
        <BaseInput autoFocus ref={ref} />
      </StrictMode>,
      { createNodeMock: () => input },
    );
  });
  expect(ref.current).toBe(input);
  expect(input.focus).not.toHaveBeenCalled();

  act(() => {
    vi.runAllTimers();
  });
  expect(input.focus).toHaveBeenCalledOnce();
  act(() => {
    renderer!.unmount();
  });
  renderer = undefined;
  expect(ref.current).toBeNull();
});

test("keeps the ref attached during typing and runs its cleanup on unmount", () => {
  const cleanup = vi.fn();
  const ref = vi.fn(() => cleanup);
  act(() => {
    renderer = create(<BaseInput autoFocus ref={ref} value="" />, {
      createNodeMock: () => input,
    });
  });
  act(() => {
    renderer!.update(<BaseInput autoFocus ref={ref} value="sample" />);
  });

  expect(ref).toHaveBeenCalledOnce();
  expect(cleanup).not.toHaveBeenCalled();
  act(() => {
    renderer!.unmount();
  });
  renderer = undefined;
  act(() => {
    vi.runAllTimers();
  });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(input.focus).not.toHaveBeenCalled();
});

test("cancels a pending focus when disabled and supports enabling it later", () => {
  act(() => {
    renderer = create(<BaseInput autoFocus />, { createNodeMock: () => input });
  });
  act(() => {
    renderer!.update(<BaseInput autoFocus={false} />);
  });
  act(() => {
    vi.runAllTimers();
  });
  expect(input.focus).not.toHaveBeenCalled();

  act(() => {
    renderer!.update(<BaseInput autoFocus />);
  });
  act(() => {
    vi.runAllTimers();
  });
  expect(input.focus).toHaveBeenCalledOnce();
});

test("does not schedule focus for an input that is already focused", () => {
  input.isFocused.mockReturnValue(true);
  act(() => {
    renderer = create(<BaseInput autoFocus />, { createNodeMock: () => input });
  });

  expect(vi.getTimerCount()).toBe(0);
  act(() => {
    vi.runAllTimers();
  });
  expect(input.focus).not.toHaveBeenCalled();
});
