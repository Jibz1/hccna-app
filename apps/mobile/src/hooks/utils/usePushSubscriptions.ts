import { getAuth } from "@react-native-firebase/auth";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useRef } from "react";
import type { Environment } from "relay-runtime";

import { environmentAtom } from "@/environment";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import {
  fetchUserProfileQuery,
  shouldRefreshUserDataQuery,
  recordUserDataQueryRefresh,
} from "@/hooks/relay/useUserData";
import { useNotificationSettingsEnabled } from "@/hooks/utils/useNotificationSettingsEnabled";
import { useDevicePrefs } from "@/utils/devicePrefs";
import { notificationChannels } from "@/utils/notificationCategories";
import type { PushSubscriptions } from "@/utils/pushSubscriptions";
import { getPushTokenRelayScope } from "@/utils/pushTokenAuth";
import { captureException } from "@/utils/sentry";

/** Compose all saved subscription choices here, including on token refresh. */
export function usePushSubscriptions() {
  const environmentState = useAtomValue(environmentAtom);
  const inFlight = useRef(new WeakSet<Environment>());
  const preferredCampus = usePreferredCampus();
  const { notificationCategoriesOff, followedCampusSlugs } = useDevicePrefs();
  const settingsEnabled = useNotificationSettingsEnabled();
  const subscriptions = useMemo<PushSubscriptions>(
    () => ({
      channels: settingsEnabled
        ? notificationChannels(
            notificationCategoriesOff,
            followedCampusSlugs,
            preferredCampus.slug,
          )
        : [],
      preferredCampus: { version: preferredCampus.version },
    }),
    [
      followedCampusSlugs,
      notificationCategoriesOff,
      preferredCampus.slug,
      preferredCampus.version,
      settingsEnabled,
    ],
  );

  const refresh = useCallback(() => {
    const user = getAuth().currentUser;
    if (
      user &&
      !user.isAnonymous &&
      environmentState?.authScope === getPushTokenRelayScope() &&
      !inFlight.current.has(environmentState.environment) &&
      shouldRefreshUserDataQuery(
        environmentState.environment,
        "UserProfileQuery",
      )
    ) {
      const { environment } = environmentState;
      const requests = inFlight.current;
      requests.add(environment);
      void fetchUserProfileQuery(environment)
        .then((profile) => {
          if (profile) {
            recordUserDataQueryRefresh(environment, "UserProfileQuery");
          }
        })
        .catch(captureException)
        .finally(() => requests.delete(environment));
    }
  }, [environmentState]);

  return { subscriptions, isReady: preferredCampus.isLoaded, refresh };
}
