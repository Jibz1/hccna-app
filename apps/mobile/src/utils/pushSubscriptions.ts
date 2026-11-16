import { Schema } from "effect";

import { NonNegativeInt, TrimmedNonEmptyString } from "@/effect/schema";
import type { PushTokensRegisterPushTokenMutation } from "@/utils/__generated__/PushTokensRegisterPushTokenMutation.graphql";

/** The complete desired set; registration replaces the previous subscriptions. */
export const PushSubscriptions = Schema.Struct({
  channels: Schema.Array(TrimmedNonEmptyString),
  preferredCampus: Schema.NullOr(Schema.Struct({ version: NonNegativeInt })),
});
export type PushSubscriptions = typeof PushSubscriptions.Type;

export type PushSubscriptionReceipt = {
  readonly subscriptions: PushSubscriptions;
  readonly topics: readonly string[];
};

export function normalizePushSubscriptions(
  subscriptions: PushSubscriptions,
): PushSubscriptions {
  return {
    channels: [
      ...new Set(
        subscriptions.channels.map((channel) => channel.trim()).filter(Boolean),
      ),
    ].sort(),
    preferredCampus: subscriptions.preferredCampus
      ? { version: subscriptions.preferredCampus.version }
      : null,
  };
}

export function pushSubscriptionsKey(subscriptions: PushSubscriptions): string {
  return JSON.stringify(normalizePushSubscriptions(subscriptions));
}

type RegistrationInput =
  PushTokensRegisterPushTokenMutation["variables"]["input"];
type RegistrationResult = NonNullable<
  PushTokensRegisterPushTokenMutation["response"]["registerPushToken"]
>;

export function pushSubscriptionInput(
  subscriptions: PushSubscriptions,
): Pick<RegistrationInput, "channels" | "followPreferredCampus"> {
  return {
    channels: subscriptions.channels,
    followPreferredCampus: subscriptions.preferredCampus !== null,
  };
}

/** Only this adapter understands server-owned subscription policies. */
export function confirmPushSubscriptions(
  requested: PushSubscriptions,
  result: RegistrationResult,
): PushSubscriptionReceipt | null {
  const confirmed = normalizePushSubscriptions(requested);
  if (requested.preferredCampus) {
    if (
      !result.campusSlug?.trim() ||
      !Schema.is(NonNegativeInt)(result.campusPreferenceVersion)
    ) {
      return null;
    }
    return {
      subscriptions: {
        ...confirmed,
        preferredCampus: { version: result.campusPreferenceVersion },
      },
      topics: result.topics,
    };
  }
  return { subscriptions: confirmed, topics: result.topics };
}
