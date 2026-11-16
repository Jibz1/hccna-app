import * as Notifications from "expo-notifications";
import { useRootNavigationState, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { notificationDestination } from "@/utils/notificationDestination";
import { captureException } from "@/utils/sentry";

// Survives Strict Mode/remounts while clearing Expo's persisted last response.
const handledResponses = new Set<string>();

export function useNotificationRouting(native: boolean) {
  const router = useRouter();
  const navigation = useRootNavigationState();
  const [pending, setPending] = useState<Notifications.NotificationResponse>();

  useEffect(() => {
    if (!native) {
      return;
    }
    let active = true;
    let receivedLiveResponse = false;
    const listener = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        receivedLiveResponse = true;
        setPending(response);
      },
    );
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (active && response && !receivedLiveResponse) {
          setPending(response);
        }
      })
      .catch(captureException);
    return () => {
      active = false;
      listener.remove();
    };
  }, [native]);

  useEffect(() => {
    if (!navigation?.key || !pending) {
      return;
    }
    const key = `${pending.notification.request.identifier}:${pending.actionIdentifier}`;
    if (!handledResponses.has(key)) {
      const destination = notificationDestination(pending.notification.request);
      if (destination) {
        router.push(destination);
      }
      handledResponses.add(key);
      if (handledResponses.size > 50) {
        handledResponses.delete(handledResponses.values().next().value!);
      }
    }
    void Notifications.clearLastNotificationResponseAsync().catch(
      captureException,
    );
  }, [navigation?.key, pending, router]);
}
