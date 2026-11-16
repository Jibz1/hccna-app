import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import { clearPushRegistration as clearPushRegistrationEffect } from "@/effect/pushRegistrationService";

export function cancelAndClearPushRegistration(): Promise<void> {
  return runLiveAppEffect(clearPushRegistrationEffect());
}
