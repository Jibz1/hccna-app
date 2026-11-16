import * as Application from "expo-application";
import Constants from "expo-constants";
import { useRouter } from "expo-router";

import { useNotificationSettingsEnabled } from "@/hooks/utils/useNotificationSettingsEnabled";

import { MoreRow, MoreSection } from "./MoreSection";

export function AppSection() {
  const router = useRouter();
  const notificationSettings = useNotificationSettingsEnabled();
  // The config tracks native-version.js even when the development build is older.
  const version =
    Constants.expoConfig?.version ??
    Application.nativeApplicationVersion ??
    "Unavailable";
  const build = Application.nativeBuildVersion;

  return (
    <MoreSection title="App">
      <MoreRow
        title="Privacy Policy"
        subtitle="How we care for your information"
        icon="shield-halved"
        href="https://hccnj.org/privacy-policy/"
      />
      <MoreRow
        title="What’s New"
        subtitle="Explore the latest app updates"
        icon="gift"
        onPress={() => {
          router.navigate("/whats-new");
        }}
      />
      {notificationSettings ? (
        <MoreRow
          title="Notifications"
          subtitle="Choose what this device receives"
          icon="bell"
          onPress={() => {
            router.navigate("/notifications");
          }}
        />
      ) : null}
      <MoreRow
        title="Permissions"
        subtitle="Notifications, camera and photos"
        icon="sliders"
        onPress={() => {
          router.navigate("/permissions");
        }}
      />
      <MoreRow
        title="App version"
        subtitle={build ? `${version} (${build})` : version}
        icon="circle-info"
        last
      />
    </MoreSection>
  );
}
