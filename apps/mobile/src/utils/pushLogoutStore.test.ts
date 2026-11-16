import { describe, expect, it } from "vitest";

import { makePushLogoutStore } from "./pushLogoutStore";

function harness() {
  const values = new Map<string, string>();
  const storage = {
    getString: (key: string) => values.get(key),
    set: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  let next = 0;
  const restore = () => makePushLogoutStore(storage, () => `key-${++next}`);
  return { store: restore(), restore };
}

describe("push logout persistence", () => {
  it("persists pending cleanup across relaunch and rotates keys after logout", () => {
    const h = harness();
    const first = h.store.keyFor("token", "user");
    expect(h.store.keyFor("token", "user")).toBe(first);
    h.store.retire("user");
    const restored = h.restore();
    expect(restored.pending()).toEqual([
      {
        token: "token",
        uid: "user",
        logoutKey: first,
        pending: true,
        legacyUserId: "user",
      },
    ]);
    const second = restored.keyFor("token", "user");
    expect(second).not.toBe(first);
    restored.complete(first);
    expect(restored.keyFor("token", "user")).toBe(second);
    expect(restored.pending()).toEqual([]);
  });
  it("retires rotated tokens and keeps another account's new registration", () => {
    const h = harness();
    h.store.keyFor("old-token", "a");
    h.store.keyFor("new-token", "a");
    const b = h.store.keyFor("new-token", "b");
    h.store.retire("a");
    expect(h.store.pending()).toHaveLength(2);
    expect(h.store.keyFor("new-token", "b")).toBe(b);
  });
  it("recovers an auth change missed while the app was stopped", () => {
    const h = harness();
    h.store.keyFor("token", "a");
    h.restore().reconcile(undefined);
    expect(h.store.pending()).toHaveLength(1);
  });
  it("retains a legacy token's old owner for cleanup after upgrading", () => {
    const h = harness();
    h.store.retire("a", "legacy");
    h.store.retire("a", "legacy");
    expect(h.store.pending()).toEqual([
      {
        token: "legacy",
        uid: "a",
        logoutKey: "key-1",
        pending: true,
        legacyUserId: "a",
      },
    ]);
  });
});
