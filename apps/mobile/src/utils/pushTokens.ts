import { Platform } from "react-native";

import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import {
  type PushRegistrationResult,
  REGISTER_PUSH_TOKEN_TIMEOUT_MS,
  registerPushToken,
} from "@/effect/pushRegistrationService";
import type { PushSubscriptions } from "@/utils/pushSubscriptions";
import type { PushTokenPlatform } from "@/utils/pushTokenPlatform";
import {
  type PushTokensDoc,
  pushTokenRegistrationStore,
} from "@/utils/pushTokenRegistrationStore";
import { statsig } from "@/utils/statsig";

export const PUSH_TOKEN_REGISTRATION_TIMEOUT_MS =
  REGISTER_PUSH_TOKEN_TIMEOUT_MS;

export type { PushTokensDoc };
export type PushTokenRegistrationResult = PushRegistrationResult;

export const resolvePlatform = (): PushTokenPlatform =>
  Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

class PushTokenStore {
  getTokens(): PushTokensDoc | null {
    return pushTokenRegistrationStore.get();
  }

  async updatePushTokens({
    fcmToken,
    subscriptions,
  }: {
    readonly fcmToken: string;
    readonly subscriptions: PushSubscriptions;
  }): Promise<PushTokenRegistrationResult> {
    try {
      return await runLiveAppEffect(
        registerPushToken({
          token: fcmToken,
          subscriptions,
          platform: resolvePlatform(),
        }),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Push registration failed";
      statsig.logEvent("register_push_token_error", "register_push_token", {
        error: errorMessage,
      });
      console.error(
        "Failed to register push token with backend:",
        errorMessage,
      );
      return { status: "failed" };
    }
  }

  clear(): void {
    pushTokenRegistrationStore.clear();
  }
}

export const PushTokens = new PushTokenStore();

export function clearPushTokens(): void {
  PushTokens.clear();
}
