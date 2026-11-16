import { Effect, Layer } from "effect";

import { connectivity } from "@/effect/connectivity";
import {
  makePushRegistrationService,
  PushRegistrationService,
  PUSH_REGISTRATION_DURABILITY_GATE,
} from "@/effect/pushRegistrationService";
import { captureSentryException } from "@/effect/sentryService";
import { SentryServiceLive } from "@/effect/sentryServiceLive";
import { checkLiveStatsigGate } from "@/effect/statsigServiceLive";
import { pushRegistrationStorage } from "@/utils/mmkv";
import { makePushRegistrationStorage } from "@/utils/pushRegistrationStorage";
import {
  getPushTokenRegistrationUid,
  getPushTokenRegistrationScope,
} from "@/utils/pushTokenAuth";
import { pushTokenRegistrationStore } from "@/utils/pushTokenRegistrationStore";
import { executeRegisterPushTokenMutation } from "@/utils/registerPushTokenMutation";

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000, 300_000] as const;

function getRetryDelayMs(attempt: number): number {
  const baseDelay =
    RETRY_DELAYS_MS[
      Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1)
    ];
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(baseDelay * jitter);
}

function isPushRegistrationDurabilityEnabled(): boolean {
  try {
    return checkLiveStatsigGate(PUSH_REGISTRATION_DURABILITY_GATE);
  } catch (error) {
    Effect.runSync(
      captureSentryException(error).pipe(Effect.provide(SentryServiceLive)),
    );
    return false;
  }
}

export const PushRegistrationServiceLive = Layer.effect(
  PushRegistrationService,
  makePushRegistrationService({
    storage: makePushRegistrationStorage(pushRegistrationStorage),
    getCurrentUid: getPushTokenRegistrationUid,
    getCurrentAuthScope: getPushTokenRegistrationScope,
    getConnectivityStatus: connectivity.getSnapshot,
    getRetryDelayMs,
    isDurableSyncEnabled: isPushRegistrationDurabilityEnabled,
    executeRegistration: executeRegisterPushTokenMutation,
    isRegistrationConfirmed: (input, uid) =>
      pushTokenRegistrationStore.isConfirmed({
        fcmToken: input.token,
        userId: uid,
        platform: input.platform,
        subscriptions: input.subscriptions,
        authScope: getPushTokenRegistrationScope(),
      }),
    confirmRegistration: (registration, uid, receipt) => {
      pushTokenRegistrationStore.confirm({
        fcmToken: registration.token,
        userId: uid,
        platform: registration.platform,
        subscriptions: receipt.subscriptions,
        authScope: registration.authScope,
        topics: receipt.topics,
      });
    },
  }),
);
