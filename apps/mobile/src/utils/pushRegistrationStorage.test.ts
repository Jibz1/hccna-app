import { describe, expect, test } from "vitest";

import {
  makePushRegistrationStorage,
  PUSH_REGISTRATION_STORAGE_KEY,
} from "./pushRegistrationStorage";

const stored = {
  version: 3,
  command: {
    _tag: "RegisterPushToken",
    version: 3,
    authScope: "uid:user-1",
    token: "fcm-token",
    platform: "ios",
    subscriptions: { channels: ["events"], preferredCampus: { version: 2 } },
    enqueuedAtMs: 1_000,
    attempt: 3,
    nextAttemptAtMs: 16_000,
    state: "pending",
  },
};

function harness(initial: string) {
  const values = new Map([[PUSH_REGISTRATION_STORAGE_KEY, initial]]);
  const storage = makePushRegistrationStorage({
    getString: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  });
  return { values, storage };
}

describe("push registration storage compatibility", () => {
  test.each(["android", "ios", "web"])(
    "reads and writes the deployed v3 format for %s",
    (platform) => {
      const persisted = { ...stored, command: { ...stored.command, platform } };
      const { values, storage } = harness(JSON.stringify(persisted));
      const result = storage.read();
      if (result.status !== "pending") {
        throw new Error("Expected the deployed registration to load");
      }
      const registration = result.registration;
      expect(registration).toEqual({
        authScope: "uid:user-1",
        token: "fcm-token",
        platform,
        subscriptions: {
          channels: ["events"],
          preferredCampus: { version: 2 },
        },
        requestedAtMs: 1_000,
        attempt: 3,
        nextAttemptAtMs: 16_000,
        state: "pending",
      });
      storage.write(registration);
      expect(JSON.parse(values.get(PUSH_REGISTRATION_STORAGE_KEY)!)).toEqual(
        persisted,
      );
    },
  );

  test.each([
    "{",
    JSON.stringify({ ...stored, version: 2 }),
    JSON.stringify({
      ...stored,
      command: { ...stored.command, _tag: "OtherMutation" },
    }),
    JSON.stringify({ ...stored, command: { ...stored.command, attempt: -1 } }),
  ])("discards invalid or incompatible persisted data: %s", (raw) => {
    const { values, storage } = harness(raw);
    expect(storage.read()).toEqual({ status: "discarded" });
    expect(storage.read()).toEqual({ status: "empty" });
    expect(values.size).toBe(0);
  });
});
