import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  useAsyncMutation,
  type AsyncMutationCallbacks,
} from "@/hooks/useAsyncMutation";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type MutationResult = ReturnType<typeof useAsyncMutation<string, string>>;

let renderer: ReactTestRenderer | null = null;
let mutation: MutationResult | null = null;

function Probe({
  callbacks,
  mutationFn,
}: {
  callbacks?: AsyncMutationCallbacks<string>;
  mutationFn: (value: string) => Promise<string>;
}) {
  const result = useAsyncMutation({
    mutationFn,
    ...callbacks,
  });
  useLayoutEffect(() => {
    mutation = result;
  }, [result]);
  return null;
}

async function renderProbe(
  mutationFn: (value: string) => Promise<string>,
  callbacks?: AsyncMutationCallbacks<string>,
) {
  await act(async () => {
    renderer = create(createElement(Probe, { callbacks, mutationFn }));
  });
}

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = null;
  mutation = null;
});

describe("useAsyncMutation", () => {
  test("normalizes failures and keeps fire-and-forget mutation rejections handled", async () => {
    const onError = vi.fn();
    await renderProbe(
      async () => {
        throw new Error("failed");
      },
      { onError },
    );

    await act(async () => {
      mutation?.mutate("value");
      await Promise.resolve();
    });

    expect(mutation?.error?.message).toBe("failed");
    expect(mutation?.isPending).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "failed",
      }),
    );
  });
});
