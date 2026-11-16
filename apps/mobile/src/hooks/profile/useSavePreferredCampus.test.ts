import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { MutationConfig } from "relay-runtime";
import { afterEach, expect, test, vi } from "vitest";

import type { SetPreferredCampusMutation } from "./__generated__/SetPreferredCampusMutation.graphql";
import { useSavePreferredCampus } from "./useSavePreferredCampus";

const state = vi.hoisted(() => ({
  uid: "user-1",
  commit: vi.fn(),
}));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({
    currentUser: { uid: state.uid, isAnonymous: false },
  }),
}));
vi.mock("@/effect/connectivity", () => ({
  connectivity: { getSnapshot: () => "online" },
}));
vi.mock("react-relay", () => ({
  graphql: () => ({}),
  useMutation: () => [state.commit, false],
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
function Result(_props: ReturnType<typeof useSavePreferredCampus>) {
  return null;
}
function Harness() {
  return createElement(Result, useSavePreferredCampus());
}
function start() {
  state.uid = "user-1";
  state.commit.mockClear();
  act(() => {
    renderer = create(createElement(Harness));
  });
  const hook = renderer!.root.findByType(Result).props as ReturnType<
    typeof useSavePreferredCampus
  >;
  let pending!: Promise<void>;
  act(() => {
    pending = hook.save("new-breed", 2);
  });
  const config = state.commit.mock
    .calls[0][0] as MutationConfig<SetPreferredCampusMutation>;
  return { pending, config };
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("waits for database confirmation and sends the expected version", async () => {
  const { pending, config } = start();
  expect(config.variables).toEqual({
    campusSlug: "new-breed",
    expectedVersion: 2,
  });
  config.onCompleted!(
    {
      setPreferredCampus: {
        success: true,
        preferredCampusSlug: "new-breed",
        campusPreferenceVersion: 3,
        syncPending: true,
      },
    },
    null,
  );
  await expect(pending).resolves.toBeUndefined();
});

test("applies a conflict's canonical preference and explains the conflict", async () => {
  const { pending, config } = start();
  const values = new Map<string, string | number>([
    ["uid", "user-1"],
    ["campusPreferenceVersion", 2],
  ]);
  const profile = {
    getValue: (key: string) => values.get(key),
    setValue: (value: string | number, key: string) => values.set(key, value),
  };
  const result = {
    getValue: (key: string) =>
      key === "campusPreferenceVersion" ? 3 : "light-house",
  };
  config.updater!(
    {
      getRootField: () => result,
      getRoot: () => ({
        getLinkedRecord: () => ({ getLinkedRecord: () => profile }),
      }),
    } as never,
    {} as never,
  );
  expect(values.get("preferredCampusSlug")).toBe("light-house");
  config.onCompleted!(
    {
      setPreferredCampus: {
        success: false,
        preferredCampusSlug: "light-house",
        campusPreferenceVersion: 3,
        syncPending: false,
      },
    },
    null,
  );
  await act(async () => {
    await expect(pending).rejects.toThrow("another device");
  });
  expect(renderer!.root.findByType(Result).props.error.message).toContain(
    "another device",
  );
});

test("ignores a completed save after the account changes", async () => {
  const { pending, config } = start();
  state.uid = "user-2";
  const getRootField = vi.fn();
  config.updater!({ getRootField } as never, {} as never);
  expect(getRootField).not.toHaveBeenCalled();
  config.onCompleted!(
    {
      setPreferredCampus: {
        success: true,
        preferredCampusSlug: "new-breed",
        campusPreferenceVersion: 3,
        syncPending: false,
      },
    },
    null,
  );
  await act(async () => {
    await expect(pending).rejects.toThrow("account changed");
  });
});
