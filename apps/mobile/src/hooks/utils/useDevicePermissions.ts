import type { PermissionResponse } from "expo";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AppState, Platform } from "react-native";

import { captureException } from "@/utils/sentry";

export type DevicePermissionStatus =
  | "Checking…"
  | "Allowed"
  | "Not allowed"
  | "Not requested"
  | "Quiet delivery"
  | "Temporary access"
  | "Selected photos"
  | "Unavailable";

type DevicePermissions = {
  notifications: DevicePermissionStatus;
  camera: DevicePermissionStatus;
  photos: DevicePermissionStatus;
};

function permissionStatus(
  permission: PermissionResponse,
): DevicePermissionStatus {
  if (permission.granted) {
    return "Allowed";
  }
  return permission.status === "undetermined" ? "Not requested" : "Not allowed";
}

function notificationStatus(
  permission: Notifications.NotificationPermissionsStatus,
): DevicePermissionStatus {
  if (
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return "Quiet delivery";
  }
  if (
    permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL
  ) {
    return "Temporary access";
  }
  return permissionStatus(permission);
}

function readStatus<T>(
  result: PromiseSettledResult<T>,
  resolve: (permission: T) => DevicePermissionStatus,
): DevicePermissionStatus {
  if (result.status === "rejected") {
    captureException(result.reason);
    return "Unavailable";
  }
  return resolve(result.value);
}

export function useDevicePermissions() {
  const isDevice = Platform.OS === "ios" || Platform.OS === "android";
  const [permissions, setPermissions] = useState<DevicePermissions>(() => {
    const initial = isDevice ? "Checking…" : "Unavailable";
    return { notifications: initial, camera: initial, photos: initial };
  });

  useFocusEffect(
    useCallback(() => {
      if (!isDevice) {
        return;
      }

      let focused = true;
      let latestRequest = 0;
      const refresh = async () => {
        const request = ++latestRequest;
        const [notifications, camera, photos] = await Promise.allSettled([
          Notifications.getPermissionsAsync(),
          ImagePicker.getCameraPermissionsAsync(),
          ImagePicker.getMediaLibraryPermissionsAsync(),
        ]);
        if (!focused || request !== latestRequest) {
          return;
        }

        setPermissions({
          notifications: readStatus(notifications, notificationStatus),
          camera: readStatus(camera, permissionStatus),
          photos: readStatus(photos, (permission) =>
            permission.accessPrivileges === "limited"
              ? "Selected photos"
              : permissionStatus(permission),
          ),
        });
      };

      void refresh();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          void refresh();
        }
      });

      return () => {
        focused = false;
        subscription.remove();
      };
    }, [isDevice]),
  );

  return { permissions, isDevice };
}
