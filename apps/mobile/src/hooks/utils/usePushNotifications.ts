import { getAuth, onAuthStateChanged } from "@react-native-firebase/auth";
import { getMessaging, onTokenRefresh } from "@react-native-firebase/messaging";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useAtomValue } from "jotai";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, Platform } from "react-native";

import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import { connectivity } from "@/effect/connectivity";
import { ensureGraphQLClientIdentity } from "@/effect/graphqlNetworkService";
import { PUSH_REGISTRATION_SETTLE_MS } from "@/effect/pushRegistrationService";
import { environmentAtom } from "@/environment";
import { useNotificationRouting } from "@/hooks/utils/useNotificationRouting";
import { usePushSubscriptions } from "@/hooks/utils/usePushSubscriptions";
import { toast } from "@/ui/toast/Toast";
import { DevicePrefs, useDevicePrefs } from "@/utils/devicePrefs";
import { getFcmToken } from "@/utils/fcmToken";
import {
  configureAndroidChannel,
  hasNotificationPermission,
  onNotificationPermissionRequested,
} from "@/utils/notificationPermission";
import {
  getPushTokenRegistrationScope,
  getPushTokenRelayScope,
  getPushTokenRegistrationUid,
} from "@/utils/pushTokenAuth";
import { pushTokenRegistrationStore } from "@/utils/pushTokenRegistrationStore";
import { PushTokens } from "@/utils/pushTokens";
import { scheduleIdleTask } from "@/utils/scheduleIdleTask";
import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

export interface PushNotificationState {
  notification?: Notifications.Notification;
  isRegistering: boolean;
  showPrompt: boolean;
  promptError?: string;
  requestNotifications: () => Promise<void>;
  dismissPrompt: () => void;
}

function showNotificationToast(content: Notifications.NotificationContent) {
  if (content.title) {
    toast.notification({
      title: content.title,
      message: content.body ?? undefined,
    });
  }
  Notifications.setBadgeCountAsync(0).catch(captureException);
}

const subscribeIdentity = (listener: () => void) =>
  onAuthStateChanged(getAuth(), listener);

export function usePushNotifications({
  canShowPrompt = false,
}: { canShowPrompt?: boolean } = {}): PushNotificationState {
  const native = Platform.OS === "ios" || Platform.OS === "android";
  const identityScope = useSyncExternalStore(
    subscribeIdentity,
    getPushTokenRegistrationScope,
    getPushTokenRegistrationScope,
  );
  const environmentState = useAtomValue(environmentAtom);
  const uid =
    environmentState?.authScope === getPushTokenRelayScope()
      ? getPushTokenRegistrationUid()
      : undefined;
  const {
    subscriptions,
    isReady: subscriptionsReady,
    refresh: refreshSubscriptions,
  } = usePushSubscriptions();
  const registrationRevision = useSyncExternalStore(
    pushTokenRegistrationStore.subscribe,
    pushTokenRegistrationStore.getRevision,
    pushTokenRegistrationStore.getRevision,
  );
  useNotificationRouting(native);
  const { notificationPromptHandled } = useDevicePrefs();
  const [notification, setNotification] =
    useState<Notifications.Notification>();
  const [permission, setPermission] =
    useState<Notifications.NotificationPermissionsStatus>();
  const [appState, setAppState] = useState(AppState.currentState);
  const [eligibleVisit, setEligibleVisit] = useState(false);
  const [registeringUid, setRegisteringUid] = useState<string>();
  const [isRequesting, setIsRequesting] = useState(false);
  const [promptError, setPromptError] = useState<string>();
  const checkedHomeVisit = useRef(false);
  const requesting = useRef(false);
  const permissionCheck = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!native || !canShowPrompt) {
      checkedHomeVisit.current = false;
      return;
    }
    if (checkedHomeVisit.current) {
      return;
    }
    checkedHomeVisit.current = true;
    const visited =
      DevicePrefs.ensure().notificationPromptHasVisitedHome === true;
    setEligibleVisit(visited);
    if (!visited) {
      DevicePrefs.update({ notificationPromptHasVisitedHome: true });
    }
  }, [canShowPrompt, native]);

  useEffect(() => {
    if (!native) {
      return;
    }
    let active = true;
    const refresh = async () => {
      if (requesting.current) {
        return;
      }
      const check = ++permissionCheck.current;
      try {
        const next = await Notifications.getPermissionsAsync();
        if (!getAuth().currentUser) {
          await runLiveAppEffect(ensureGraphQLClientIdentity());
        }
        if (!active) {
          return;
        }
        refreshSubscriptions();
        if (active && check === permissionCheck.current) {
          // Recheck registration on foreground/token refresh even if access is unchanged.
          setPermission({ ...next });
        }
      } catch (error) {
        captureException(error);
      }
    };
    const task = scheduleIdleTask(refresh);
    const unsubscribeConnectivity = connectivity.subscribeConnectivityRestored(
      () => {
        void refresh();
      },
    );
    const subscription = AppState.addEventListener("change", (state) => {
      setAppState(state);
      if (state === "active") {
        void refresh();
      }
    });
    const unsubscribePermission = onNotificationPermissionRequested(() => {
      void refresh();
    });
    const unsubscribeToken = Device.isDevice
      ? onTokenRefresh(getMessaging(), () => {
          void refresh();
        })
      : undefined;
    return () => {
      active = false;
      task.cancel();
      unsubscribeConnectivity();
      unsubscribePermission();
      subscription.remove();
      unsubscribeToken?.();
    };
  }, [native, refreshSubscriptions]);

  useEffect(() => {
    // iOS freezes timers while suspended, so a due timer would fire into the
    // resume burst. Backgrounding cancels; the next foreground re-arms.
    if (
      !native ||
      !Device.isDevice ||
      appState === "background" ||
      !uid ||
      !subscriptionsReady ||
      !permission ||
      !hasNotificationPermission(permission)
    ) {
      return;
    }
    let active = true;
    const controller = new AbortController();
    const register = async () => {
      if (
        getPushTokenRegistrationUid() !== uid ||
        getPushTokenRegistrationScope() !== identityScope
      ) {
        return;
      }
      setRegisteringUid(uid);
      try {
        await configureAndroidChannel();
        const fcmToken = await getFcmToken(controller.signal);
        if (
          fcmToken === undefined ||
          !active ||
          getPushTokenRegistrationUid() !== uid ||
          getPushTokenRegistrationScope() !== identityScope
        ) {
          return;
        }
        const registration = await PushTokens.updatePushTokens({
          fcmToken,
          subscriptions,
        });
        if (
          registration.status === "confirmed" ||
          registration.status === "unchanged"
        ) {
          statsig.logEvent("update_push_tokens_success", "update_push_tokens");
        } else if (registration.status === "queued") {
          statsig.logEvent("update_push_tokens_queued", "update_push_tokens");
        } else if (registration.status === "failed") {
          statsig.logEvent("update_push_tokens_failure", "update_push_tokens", {
            status: registration.status,
          });
        }
      } catch (error) {
        if (active) {
          captureException(error);
        }
      } finally {
        if (active) {
          setRegisteringUid(undefined);
        }
      }
    };
    const timer = setTimeout(() => {
      void register();
    }, PUSH_REGISTRATION_SETTLE_MS);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    native,
    appState,
    permission,
    uid,
    identityScope,
    subscriptions,
    subscriptionsReady,
    registrationRevision,
  ]);

  const dismissPrompt = useCallback(() => {
    DevicePrefs.update({ notificationPromptHandled: true });
  }, []);

  const requestNotifications = async () => {
    if (
      !native ||
      !uid ||
      getPushTokenRegistrationUid() !== uid ||
      getPushTokenRegistrationScope() !== identityScope ||
      requesting.current
    ) {
      return;
    }
    requesting.current = true;
    permissionCheck.current += 1;
    setIsRequesting(true);
    setPromptError(undefined);
    try {
      // Android needs its channel before requesting permission or fetching tokens.
      await configureAndroidChannel();
      const current = await Notifications.getPermissionsAsync();
      if (
        !mounted.current ||
        getPushTokenRegistrationUid() !== uid ||
        getPushTokenRegistrationScope() !== identityScope
      ) {
        return;
      }
      const next =
        !hasNotificationPermission(current) && current.canAskAgain
          ? await Notifications.requestPermissionsAsync()
          : current;
      if (mounted.current) {
        dismissPrompt();
        setPermission(next);
      }
    } catch (error) {
      captureException(error);
      if (mounted.current) {
        setPromptError("Couldn't turn on notifications. Please try again.");
      }
    } finally {
      requesting.current = false;
      if (mounted.current) {
        setIsRequesting(false);
      }
    }
  };

  useEffect(() => {
    if (!native) {
      return;
    }
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    Notifications.setBadgeCountAsync(0).catch(captureException);
    const received = Notifications.addNotificationReceivedListener((next) => {
      setNotification(next);
      showNotificationToast(next.request.content);
    });
    return () => {
      received.remove();
    };
  }, [native]);

  return {
    notification,
    isRegistering:
      isRequesting ||
      Boolean(
        uid &&
        uid === registeringUid &&
        permission &&
        hasNotificationPermission(permission),
      ),
    showPrompt: Boolean(
      native &&
      uid &&
      canShowPrompt &&
      eligibleVisit &&
      appState === "active" &&
      !notificationPromptHandled &&
      permission?.status === "undetermined" &&
      permission.canAskAgain &&
      !hasNotificationPermission(permission),
    ),
    promptError,
    requestNotifications,
    dismissPrompt,
  };
}
