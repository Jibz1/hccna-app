import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const listeners = new Set<() => void>();

export function hasNotificationPermission(
  permission: Notifications.NotificationPermissionsStatus,
): boolean {
  return (
    permission.granted ||
    permission.ios?.status ===
      Notifications.IosAuthorizationStatus.PROVISIONAL ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

export async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Church updates",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }
}

/** Lets push registration notice permission granted outside its own prompt. */
export function onNotificationPermissionRequested(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows the system prompt when it can still be shown; otherwise reads the current status. */
export async function requestNotificationPermission(): Promise<Notifications.NotificationPermissionsStatus> {
  // Android needs its channel before requesting permission or fetching tokens.
  await configureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  const next =
    !hasNotificationPermission(current) && current.canAskAgain
      ? await Notifications.requestPermissionsAsync()
      : current;
  listeners.forEach((listener) => {
    listener();
  });
  return next;
}
