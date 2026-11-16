import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import * as Notifications from "expo-notifications";
import { useState } from "react";
import { Platform, Pressable } from "react-native";

import { NotificationPromptSheet } from "@/components/notifications/PushNotificationPrompt";
import { useNotificationSettingsEnabled } from "@/hooks/utils/useNotificationSettingsEnabled";
import { useAppTheme } from "@/theme/useAppTheme";
import { toast } from "@/ui/toast/Toast";
import { DevicePrefs, useDevicePrefs } from "@/utils/devicePrefs";
import {
  setFollowedCampus,
  setNotificationCategory,
} from "@/utils/notificationCategories";
import {
  hasNotificationPermission,
  requestNotificationPermission,
} from "@/utils/notificationPermission";
import { openPermissionSettings } from "@/utils/openPermissionSettings";
import { captureException } from "@/utils/sentry";
import { cn } from "@/utils/styling";

type Ask = "request" | "settings";

/**
 * Livestream alerts for one campus, like following an account on X. The
 * device's own campus is covered by the Livestreams category; other campuses
 * are followed individually.
 */
export function CampusFollowBell({
  campusSlug,
  campusName,
  isOwnCampus,
}: {
  campusSlug: string;
  campusName: string;
  isOwnCampus: boolean;
}) {
  const { colors } = useAppTheme();
  const { notificationCategoriesOff, followedCampusSlugs } = useDevicePrefs();
  const [ask, setAsk] = useState<Ask>();
  const [isRequesting, setIsRequesting] = useState(false);
  const enabled = useNotificationSettingsEnabled();
  const following = isOwnCampus
    ? !notificationCategoriesOff?.includes("livestreams")
    : Boolean(followedCampusSlugs?.includes(campusSlug));

  if (!enabled || (Platform.OS !== "ios" && Platform.OS !== "android")) {
    return null;
  }

  const setFollowing = (next: boolean) => {
    DevicePrefs.update(
      isOwnCampus
        ? {
            notificationCategoriesOff: setNotificationCategory(
              notificationCategoriesOff,
              "livestreams",
              next,
            ),
            // A follow kept from before this became the device's campus would
            // come back if the campus changes again, so the category replaces it.
            followedCampusSlugs: setFollowedCampus(
              followedCampusSlugs,
              campusSlug,
              false,
            ),
          }
        : {
            followedCampusSlugs: setFollowedCampus(
              followedCampusSlugs,
              campusSlug,
              next,
            ),
          },
    );
  };

  const confirmFollowing = () => {
    toast.success({
      title: "Livestream alerts on",
      message: `We'll let you know when ${campusName} goes live.`,
    });
  };

  const toggle = () => {
    if (following) {
      setFollowing(false);
      toast.success({
        title: "Livestream alerts off",
        message: `You won't be notified when ${campusName} goes live.`,
      });
      return;
    }
    // The choice is kept even without permission; it applies once notifications are allowed.
    setFollowing(true);
    Notifications.getPermissionsAsync()
      .then((permission) => {
        if (hasNotificationPermission(permission)) {
          confirmFollowing();
        } else {
          setAsk(permission.canAskAgain ? "request" : "settings");
        }
      })
      .catch(captureException);
  };

  const turnOn = async () => {
    if (ask === "settings") {
      setAsk(undefined);
      await openPermissionSettings("notifications").catch(captureException);
      return;
    }
    setIsRequesting(true);
    try {
      const permission = await requestNotificationPermission();
      setAsk(undefined);
      if (hasNotificationPermission(permission)) {
        confirmFollowing();
      }
    } catch (error) {
      setAsk(undefined);
      captureException(error);
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={`Livestream alerts for ${campusName}`}
        accessibilityState={{ checked: following }}
        onPress={toggle}
        className={cn(
          "size-11 items-center justify-center rounded-full border active:opacity-70",
          following
            ? "border-design-accent/60 bg-design-selected"
            : "border-design-border bg-design-surface",
        )}
      >
        <FontAwesome6
          name="bell"
          solid={following}
          size={17}
          color={following ? colors.accent : colors.textMuted}
        />
      </Pressable>
      <NotificationPromptSheet
        showPrompt={ask !== undefined}
        isRegistering={isRequesting}
        requestNotifications={turnOn}
        dismissPrompt={() => {
          setAsk(undefined);
        }}
        title={`Get notified when ${campusName} goes live?`}
        message={
          ask === "settings"
            ? "Notifications are off for HCCNA. Turn them on in Settings, then we'll let you know when this campus goes live."
            : isOwnCampus
              ? "You can change this anytime in Settings → Notifications."
              : "Tap the bell again anytime to stop these alerts."
        }
        confirmLabel={ask === "settings" ? "Open Settings" : "Turn on"}
      />
    </>
  );
}
