import { Schema } from "effect";

import { NonNegativeInt, TrimmedNonEmptyString } from "@/effect/schema";
import { PushSubscriptions } from "@/utils/pushSubscriptions";
import { PushTokenPlatform } from "@/utils/pushTokenPlatform";

const Registration = Schema.Struct({
  authScope: TrimmedNonEmptyString,
  subscriptions: PushSubscriptions,
  token: TrimmedNonEmptyString,
  platform: PushTokenPlatform,
});

export type PushRegistration = typeof Registration.Type;
export type PushRegistrationInput = Omit<PushRegistration, "authScope">;
export type PendingPushRegistration = PushRegistration & {
  readonly requestedAtMs: number;
  readonly attempt: number;
  readonly nextAttemptAtMs: number;
  readonly state: "failed" | "pending";
};

export type PushRegistrationRead =
  | { readonly status: "empty" | "discarded" }
  | {
      readonly status: "pending";
      readonly registration: PendingPushRegistration;
    };

export type PushRegistrationStorage = {
  readonly read: () => PushRegistrationRead;
  readonly write: (registration: PendingPushRegistration) => void;
  readonly clear: () => void;
};

// Keep the deployed v3 format readable by both app updates and rollbacks.
// Command tags and envelope versions belong only to this storage boundary.
export const PUSH_REGISTRATION_STORAGE_KEY = "outbox";
const StoredRegistration = Schema.Struct({
  version: Schema.Literal(3),
  command: Schema.TaggedStruct("RegisterPushToken", {
    version: Schema.Literal(3),
    ...Registration.fields,
    enqueuedAtMs: NonNegativeInt,
    attempt: NonNegativeInt,
    nextAttemptAtMs: NonNegativeInt,
    state: Schema.Literals(["failed", "pending"]),
  }),
});
const decode = Schema.decodeUnknownSync(StoredRegistration);

export function makePushRegistrationStorage(storage: {
  readonly getString: (key: string) => string | undefined;
  readonly set: (key: string, value: string) => void;
  readonly remove: (key: string) => void;
}): PushRegistrationStorage {
  return {
    read: () => {
      const raw = storage.getString(PUSH_REGISTRATION_STORAGE_KEY);
      if (!raw) {
        return { status: "empty" };
      }
      let stored: typeof StoredRegistration.Type;
      try {
        stored = decode(JSON.parse(raw));
      } catch {
        storage.remove(PUSH_REGISTRATION_STORAGE_KEY);
        return { status: "discarded" };
      }
      const { _tag, version, enqueuedAtMs, ...registration } = stored.command;
      return {
        status: "pending",
        registration: { ...registration, requestedAtMs: enqueuedAtMs },
      };
    },
    write: ({ requestedAtMs, ...registration }) => {
      storage.set(
        PUSH_REGISTRATION_STORAGE_KEY,
        JSON.stringify({
          version: 3,
          command: {
            _tag: "RegisterPushToken",
            version: 3,
            ...registration,
            enqueuedAtMs: requestedAtMs,
          },
        }),
      );
    },
    clear: () => {
      storage.remove(PUSH_REGISTRATION_STORAGE_KEY);
    },
  };
}
