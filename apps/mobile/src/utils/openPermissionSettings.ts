import { applicationId } from "expo-application";
import { Linking, Platform } from "react-native";

export type DevicePermission = "notifications" | "camera" | "photos";

export async function openPermissionSettings(
  permission: DevicePermission,
): Promise<void> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return;
  }

  if (permission === "notifications") {
    if (Platform.OS === "ios") {
      // UIApplication.openNotificationSettingsURLString (iOS 16+).
      await Linking.openURL("app-settings:notifications").catch(() =>
        Linking.openSettings(),
      );
      return;
    }

    if (Number(Platform.Version) >= 26 && applicationId) {
      await Linking.sendIntent("android.settings.APP_NOTIFICATION_SETTINGS", [
        { key: "android.provider.extra.APP_PACKAGE", value: applicationId },
      ]).catch(() => Linking.openSettings());
      return;
    }
  }

  // Neither platform exposes a public deep link to an app's camera/photos page.
  await Linking.openSettings();
}
