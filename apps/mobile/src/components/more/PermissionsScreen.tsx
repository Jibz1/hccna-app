import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Platform, Pressable, View } from "react-native";

import { DetailModalLayout } from "@/components/layout/DetailModalLayout";
import { MoreSection } from "@/components/more/MoreSection";
import {
  type DevicePermissionStatus,
  useDevicePermissions,
} from "@/hooks/utils/useDevicePermissions";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import {
  type DevicePermission,
  openPermissionSettings,
} from "@/utils/openPermissionSettings";
import { captureException } from "@/utils/sentry";

function PermissionRow({
  title,
  description,
  icon,
  status,
  settingsLabel,
  settingsHint,
  onOpenSettings,
  last = false,
}: {
  title: string;
  description: string;
  icon: string;
  status: DevicePermissionStatus;
  settingsLabel: string;
  settingsHint?: string;
  onOpenSettings?: () => void;
  last?: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <View>
      <View className="gap-3 px-[18px] py-5">
        <View className="flex-row items-center gap-3">
          <View className="bg-design-selected size-10 items-center justify-center rounded-[14px]">
            <FontAwesome6 name={icon} size={17} color={colors.accent} />
          </View>
          <View className="flex-1 flex-row flex-wrap items-center justify-between gap-2">
            <Text variant="body/medium" color="designPrimary">
              {title}
            </Text>
            <View className="bg-design-selected rounded-full px-3 py-1.5">
              <Text
                accessibilityLabel={`${title}: ${status}`}
                accessibilityLiveRegion="polite"
                variant="caption/medium"
                color="designAccent"
              >
                {status}
              </Text>
            </View>
          </View>
        </View>
        <Text variant="caption/regular" color="designMuted">
          {description}
        </Text>
        {onOpenSettings ? (
          <View className="gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityHint={settingsHint}
              onPress={onOpenSettings}
              className="bg-design-selected min-h-12 items-center justify-center rounded-full px-5 py-3 active:opacity-80"
            >
              <Text variant="body/medium" color="designAccent">
                {settingsLabel}
              </Text>
            </Pressable>
            {settingsHint ? (
              <Text variant="caption/regular" color="designMuted">
                {settingsHint}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {!last ? <View className="bg-design-border mx-[18px] h-px" /> : null}
    </View>
  );
}

export function PermissionsScreen() {
  const { permissions, isDevice } = useDevicePermissions();
  const openSettings = (permission: DevicePermission) => {
    void openPermissionSettings(permission).catch((cause: unknown) => {
      toast.error({
        title: "Unable to open Settings. Please open your device settings.",
      });
      captureException(cause);
    });
  };

  return (
    <DetailModalLayout title="Permissions" closeLabel="Close permissions">
      <View className="items-center px-[22px]">
        <View className="w-full max-w-[540px] gap-6">
          <Text variant="body/regular" color="designMuted">
            See what HCCNA can access on your device.
          </Text>
          <MoreSection title="Device access">
            <PermissionRow
              title="Notifications"
              description="Receive church updates and reminders."
              icon="bell"
              status={permissions.notifications}
              settingsLabel="Notification settings"
              onOpenSettings={
                isDevice
                  ? () => {
                      openSettings("notifications");
                    }
                  : undefined
              }
            />
            <PermissionRow
              title="Camera"
              description="Take a photo for your profile. Access is requested when you use the camera."
              icon="camera"
              status={permissions.camera}
              settingsLabel="Camera settings"
              settingsHint={
                Platform.OS === "android"
                  ? "In HCCNA settings, choose Permissions, then Camera."
                  : "In HCCNA settings, choose Camera."
              }
              onOpenSettings={
                isDevice
                  ? () => {
                      openSettings("camera");
                    }
                  : undefined
              }
            />
            <PermissionRow
              title="Photos"
              description="Choose a profile photo. The system photo picker can share a photo without full library access."
              icon="images"
              status={permissions.photos}
              settingsLabel="Photo settings"
              settingsHint={
                Platform.OS === "android"
                  ? "Manage photo access under Permissions in HCCNA settings."
                  : "In HCCNA settings, choose Photos."
              }
              onOpenSettings={
                isDevice
                  ? () => {
                      openSettings("photos");
                    }
                  : undefined
              }
              last
            />
          </MoreSection>
          {isDevice ? (
            <Text variant="caption/regular" color="designMuted" centered>
              Your changes appear here when you return from Settings.
            </Text>
          ) : (
            <Text variant="caption/regular" color="designMuted">
              Open HCCNA on your device to view and manage these permissions.
            </Text>
          )}
        </View>
      </View>
    </DetailModalLayout>
  );
}
