import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import * as Notifications from "expo-notifications";
import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { AppState, Platform, Pressable, Switch, View } from "react-native";

import { DetailModalLayout } from "@/components/layout/DetailModalLayout";
import { MoreSection } from "@/components/more/MoreSection";
import { useNotificationSettingsEnabled } from "@/hooks/utils/useNotificationSettingsEnabled";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { DevicePrefs, useDevicePrefs } from "@/utils/devicePrefs";
import {
  NOTIFICATION_CATEGORIES,
  setNotificationCategory,
} from "@/utils/notificationCategories";
import {
  hasNotificationPermission,
  requestNotificationPermission,
} from "@/utils/notificationPermission";
import { openPermissionSettings } from "@/utils/openPermissionSettings";
import { captureException } from "@/utils/sentry";

type Permission = Notifications.NotificationPermissionsStatus;

function useNotificationPermission(native: boolean) {
  const [permission, setPermission] = useState<Permission>();

  useFocusEffect(
    useCallback(() => {
      if (!native) {
        return;
      }
      let focused = true;
      const refresh = () => {
        Notifications.getPermissionsAsync()
          .then((next) => {
            if (focused) {
              setPermission(next);
            }
          })
          .catch(captureException);
      };
      refresh();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          refresh();
        }
      });
      return () => {
        focused = false;
        subscription.remove();
      };
    }, [native]),
  );

  return [permission, setPermission] as const;
}

function NotificationRow({
  title,
  description,
  icon,
  children,
  last = false,
}: {
  title: string;
  description: string;
  icon: string;
  children: ReactNode;
  last?: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <View>
      <View className="min-h-[76px] flex-row items-center gap-3.5 px-[18px] py-3">
        <View className="bg-design-selected size-10 items-center justify-center rounded-[14px]">
          <FontAwesome6 name={icon} size={17} color={colors.accent} />
        </View>
        <View className="flex-1 gap-1">
          <Text variant="body/medium" color="designPrimary">
            {title}
          </Text>
          <Text variant="caption/regular" color="designMuted">
            {description}
          </Text>
        </View>
        {children}
      </View>
      {!last ? (
        <View className="bg-design-border mr-[18px] ml-[72px] h-px" />
      ) : null}
    </View>
  );
}

function PermissionBanner({
  canAskAgain,
  onTurnOn,
}: {
  canAskAgain: boolean;
  onTurnOn: () => void;
}) {
  const { colors, isDark } = useAppTheme();

  return (
    <View className="border-continuous border-design-accent/40 bg-design-surface-strong gap-3 rounded-[26px] border p-[18px]">
      <View className="flex-row items-center gap-2.5">
        <FontAwesome6 name="bell-slash" size={16} color={colors.accent} />
        <Text
          accessibilityRole="header"
          variant="body/medium"
          color="designPrimary"
        >
          Notifications are off
        </Text>
      </View>
      <Text variant="caption/regular" color="designMuted">
        {canAskAgain
          ? "Turn them on to get the updates you choose below."
          : "Turn them on in Settings to get the updates you choose below."}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onTurnOn}
        className="bg-design-accent min-h-12 items-center justify-center rounded-full px-5 py-3 active:opacity-80"
      >
        <Text
          variant="body/medium"
          color={isDark ? "designBackground" : "onImage"}
        >
          {canAskAgain ? "Turn on notifications" : "Open Settings"}
        </Text>
      </Pressable>
    </View>
  );
}

function NotificationSettings() {
  const native = Platform.OS === "ios" || Platform.OS === "android";
  const { colors } = useAppTheme();
  const { notificationCategoriesOff } = useDevicePrefs();
  const [permission, setPermission] = useNotificationPermission(native);
  const allowed = permission ? hasNotificationPermission(permission) : false;

  const turnOn = () => {
    if (permission?.canAskAgain) {
      requestNotificationPermission()
        .then(setPermission)
        .catch((cause: unknown) => {
          toast.error({
            title: "Couldn't turn on notifications. Please try again.",
          });
          captureException(cause);
        });
      return;
    }
    openPermissionSettings("notifications").catch((cause: unknown) => {
      toast.error({
        title: "Unable to open Settings. Please open your device settings.",
      });
      captureException(cause);
    });
  };

  return (
    <DetailModalLayout title="Notifications" closeLabel="Close notifications">
      <View className="items-center px-[22px]">
        <View className="w-full max-w-[540px] gap-6">
          {permission && !allowed ? (
            <PermissionBanner
              canAskAgain={permission.canAskAgain}
              onTurnOn={turnOn}
            />
          ) : null}
          <View className={allowed ? undefined : "opacity-50"}>
            <MoreSection title="Push notifications">
              <NotificationRow
                title="Announcements"
                description="Always on"
                icon="bullhorn"
              >
                <FontAwesome6
                  accessibilityLabel="Always on"
                  name="lock"
                  size={14}
                  color={colors.textMuted}
                />
              </NotificationRow>
              {NOTIFICATION_CATEGORIES.map((category, index) => {
                const enabled = !notificationCategoriesOff?.includes(
                  category.channel,
                );
                return (
                  <NotificationRow
                    key={category.channel}
                    title={category.title}
                    description={category.description}
                    icon={category.icon}
                    last={index === NOTIFICATION_CATEGORIES.length - 1}
                  >
                    <Switch
                      accessibilityLabel={category.title}
                      value={enabled}
                      disabled={!allowed}
                      onValueChange={(next) => {
                        DevicePrefs.update({
                          notificationCategoriesOff: setNotificationCategory(
                            notificationCategoriesOff,
                            category.channel,
                            next,
                          ),
                        });
                      }}
                      trackColor={{ false: colors.border, true: colors.accent }}
                      thumbColor={colors.surfaceStrong}
                      ios_backgroundColor={colors.border}
                    />
                  </NotificationRow>
                );
              })}
            </MoreSection>
          </View>
          <Text variant="caption/regular" color="designMuted" centered>
            {native
              ? "These choices apply to this device. To stop announcements, turn off notifications in your device settings."
              : "Open HCCNA on your device to manage notifications."}
          </Text>
        </View>
      </View>
    </DetailModalLayout>
  );
}

export function NotificationSettingsScreen() {
  // A deep link still reaches the route while the gate is off.
  return useNotificationSettingsEnabled() ? (
    <NotificationSettings />
  ) : (
    <Redirect href="/" />
  );
}
