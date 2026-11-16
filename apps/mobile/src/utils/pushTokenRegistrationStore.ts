import { Predicate, Schema } from "effect";
import * as Application from "expo-application";

import { legacySignalDbStorage, pushTokenStorage } from "@/utils/mmkv";
import {
  PushSubscriptions,
  normalizePushSubscriptions,
  pushSubscriptionsKey,
} from "@/utils/pushSubscriptions";
import { PushTokenPlatform } from "@/utils/pushTokenPlatform";

const PUSH_TOKEN_KEY = "registered";
const LEGACY_PUSH_TOKEN_KEY = "pushTokens";

export type { PushTokenPlatform };

export type PushTokensDoc = {
  readonly subscriptions?: PushSubscriptions;
  readonly authScope?: string;
  readonly clientVersion?: string;
  readonly topics?: readonly string[];
  readonly id: "push-tokens";
  readonly expoToken?: string;
  readonly fcmToken?: string;
  readonly userId?: string;
  readonly platform?: PushTokenPlatform;
  readonly channels?: readonly string[];
};

export type ConfirmedPushTokenRegistration = {
  readonly subscriptions: PushSubscriptions;
  readonly authScope: string;
  readonly topics?: readonly string[];
  readonly fcmToken: string;
  readonly userId: string;
  readonly platform: PushTokenPlatform;
};

function isPushTokensDoc(value: unknown): value is PushTokensDoc {
  if (!Predicate.isObjectOrArray(value)) {
    return false;
  }

  const candidate = value as Partial<PushTokensDoc>;
  return (
    candidate.id === "push-tokens" &&
    (candidate.subscriptions === undefined ||
      Schema.is(PushSubscriptions)(candidate.subscriptions)) &&
    (candidate.authScope === undefined ||
      Predicate.isString(candidate.authScope)) &&
    (candidate.clientVersion === undefined ||
      Predicate.isString(candidate.clientVersion)) &&
    (candidate.topics === undefined ||
      (Array.isArray(candidate.topics) &&
        candidate.topics.every(Predicate.isString))) &&
    (candidate.expoToken === undefined ||
      Predicate.isString(candidate.expoToken)) &&
    (candidate.fcmToken === undefined ||
      Predicate.isString(candidate.fcmToken)) &&
    (candidate.userId === undefined || Predicate.isString(candidate.userId)) &&
    (candidate.platform === undefined ||
      Schema.is(PushTokenPlatform)(candidate.platform)) &&
    (candidate.channels === undefined ||
      (Array.isArray(candidate.channels) &&
        candidate.channels.every((channel) => Predicate.isString(channel))))
  );
}

function parsePushTokens(value: string | undefined): PushTokensDoc | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isPushTokensDoc(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadPushTokens(): PushTokensDoc | null {
  const current = parsePushTokens(pushTokenStorage.getString(PUSH_TOKEN_KEY));
  if (current) {
    return current;
  }

  const legacyValue = legacySignalDbStorage.getString(LEGACY_PUSH_TOKEN_KEY);
  if (!legacyValue) {
    return null;
  }

  try {
    const legacyItems: unknown = JSON.parse(legacyValue);
    if (!Array.isArray(legacyItems)) {
      return null;
    }

    const migrated = legacyItems.find(isPushTokensDoc);
    if (migrated) {
      pushTokenStorage.set(PUSH_TOKEN_KEY, JSON.stringify(migrated));
      legacySignalDbStorage.remove(LEGACY_PUSH_TOKEN_KEY);
      return migrated;
    }
  } catch {
    // A malformed legacy cache should cause a fresh registration.
  }

  return null;
}

class PushTokenRegistrationStore {
  #tokens = loadPushTokens();
  #revision = 0;
  readonly #listeners = new Set<() => void>();
  getRevision = () => this.#revision;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  get(): PushTokensDoc | null {
    return this.#tokens;
  }

  isConfirmed(registration: ConfirmedPushTokenRegistration): boolean {
    return (
      this.#tokens?.fcmToken === registration.fcmToken &&
      this.#tokens.userId === registration.userId &&
      this.#tokens.platform === registration.platform &&
      this.#tokens.authScope === registration.authScope &&
      this.#tokens.clientVersion ===
        (Application.nativeApplicationVersion ?? "unknown") &&
      this.#tokens.subscriptions !== undefined &&
      pushSubscriptionsKey(this.#tokens.subscriptions) ===
        pushSubscriptionsKey(registration.subscriptions)
    );
  }

  confirm(registration: ConfirmedPushTokenRegistration): void {
    this.#tokens = {
      id: "push-tokens",
      ...registration,
      clientVersion: Application.nativeApplicationVersion ?? "unknown",
      subscriptions: normalizePushSubscriptions(registration.subscriptions),
    };
    pushTokenStorage.set(PUSH_TOKEN_KEY, JSON.stringify(this.#tokens));
  }

  clear(): void {
    this.#tokens = null;
    pushTokenStorage.remove(PUSH_TOKEN_KEY);
    this.#revision += 1;
    this.#listeners.forEach((listener) => {
      listener();
    });
  }
}

export const pushTokenRegistrationStore = new PushTokenRegistrationStore();
