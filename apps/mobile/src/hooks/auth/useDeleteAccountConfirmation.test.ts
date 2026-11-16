import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVerifyDeleteAccountCodeMutation } from "./useDeleteAccountConfirmation";

const mocks = vi.hoisted(() => ({ commit: vi.fn(), complete: vi.fn() }));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "old-user" } }),
}));
vi.mock("react-relay", () => ({
  graphql: () => ({}),
  useMutation: () => [mocks.commit, false],
}));
vi.mock("@/hooks/useAsyncMutation", () => ({
  useAsyncMutation: <T>(options: T) => options,
}));
vi.mock("@/utils/completeAccountDeletion", () => ({
  completeAccountDeletion: mocks.complete,
}));
vi.mock("@/utils/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/utils/statsig", () => ({ statsig: { logEvent: vi.fn() } }));

type Mutation = { mutationFn: (input: { code: string }) => Promise<unknown> };
function Probe() {
  const mutation = useVerifyDeleteAccountCodeMutation();
  return createElement("output", { mutation });
}
let renderer: ReactTestRenderer;
const runDeletion = () =>
  (renderer.root.findByType("output").props.mutation as Mutation).mutationFn({
    code: "123456",
  });
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("verified account deletion", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await act(async () => {
      renderer = create(createElement(Probe));
    });
  });
  afterEach(async () => {
    await act(async () => {
      renderer.unmount();
    });
  });
  it("awaits session cleanup after the server confirms deletion", async () => {
    mocks.commit.mockImplementation(({ onCompleted }) =>
      onCompleted({
        verifyDeleteAccountCode: { success: true, message: "Deleted" },
      }),
    );
    let finish!: () => void;
    mocks.complete.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const success = vi.fn();
    const pending = runDeletion().then(success);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.complete).toHaveBeenCalledWith("old-user");
    expect(success).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(success).toHaveBeenCalledOnce();
  });
  it("keeps the session when verification fails", async () => {
    mocks.commit.mockImplementation(({ onCompleted }) =>
      onCompleted({
        verifyDeleteAccountCode: { success: false, message: "Invalid code" },
      }),
    );
    await expect(runDeletion()).rejects.toThrow("Invalid code");
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
