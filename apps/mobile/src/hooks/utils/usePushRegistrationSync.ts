import { useEffect } from "react";

import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import { connectivity } from "@/effect/connectivity";
import {
  PUSH_REGISTRATION_SETTLE_MS,
  syncPushRegistration,
} from "@/effect/pushRegistrationService";
import { syncPushLogout } from "@/utils/pushLogout";
import { captureException } from "@/utils/sentry";

export function usePushRegistrationSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void syncPushLogout().catch(captureException);
        void runLiveAppEffect(syncPushRegistration()).catch(captureException);
      }, PUSH_REGISTRATION_SETTLE_MS);
    };

    sync();
    const unsubscribe = connectivity.subscribeConnectivityRestored(sync);
    const unsubscribeForeground = connectivity.subscribeForegrounded(sync);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      unsubscribeForeground();
    };
  }, [enabled]);
}
