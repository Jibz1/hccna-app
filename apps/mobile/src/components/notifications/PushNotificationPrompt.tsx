import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { usePathname } from "expo-router";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useForceUpdate } from "@/components/providers/ForceUpdate";
import { useWhatsNewPrompt } from "@/components/whats-new/useWhatsNewPrompt";
import { usePushNotifications } from "@/hooks/utils/usePushNotifications";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

export function PushNotificationPrompt() {
  const pathname = usePathname();
  const { isUpdateRequired } = useForceUpdate();
  const canShowPrompt = pathname === "/" && !isUpdateRequired;
  const whatsNewTakesPriority = useWhatsNewPrompt(canShowPrompt);
  const notifications = usePushNotifications({
    canShowPrompt: canShowPrompt && !whatsNewTakesPriority,
  });
  return <NotificationPromptSheet {...notifications} />;
}

export function NotificationPromptSheet({
  showPrompt,
  isRegistering,
  promptError,
  requestNotifications,
  dismissPrompt,
  title = "Stay connected to your church",
  message = "Receive daily verses, church announcements, and livestream updates for your selected campus. Guests receive Union updates.",
  confirmLabel = "Turn on notifications",
}: Pick<
  ReturnType<typeof usePushNotifications>,
  | "showPrompt"
  | "isRegistering"
  | "promptError"
  | "requestNotifications"
  | "dismissPrompt"
> & {
  title?: string;
  message?: string;
  confirmLabel?: string;
}) {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const close = () => {
    if (!isRegistering) {
      dismissPrompt();
    }
  };

  return (
    <Modal
      visible={showPrompt}
      transparent
      presentationStyle="overFullScreen"
      animationType={reduceMotion ? "none" : "slide"}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={close}
    >
      <View
        className="flex-1 items-center justify-end"
        style={{ paddingLeft: insets.left + 8, paddingRight: insets.right + 8 }}
      >
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          disabled={isRegistering}
          onPress={close}
          className="bg-design-photo-overlay absolute inset-0"
        />
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          style={{ maxHeight: height - insets.top - 20 }}
          className="bg-design-surface-strong border-design-border w-full max-w-[560px] overflow-hidden rounded-t-[36px] border border-b-0"
        >
          <ScrollView
            bounces={false}
            contentInsetAdjustmentBehavior="never"
            contentContainerClassName="gap-5 px-6 pt-8"
            contentContainerStyle={{
              paddingBottom: Math.max(insets.bottom, 16) + 12,
            }}
          >
            <View className="bg-design-selected h-16 w-16 items-center justify-center self-center rounded-full">
              <FontAwesome6 name="bell" size={28} color={colors.accent} />
            </View>
            <View className="gap-3">
              <Text
                accessibilityRole="header"
                variant="headingSm/bold"
                centered
                color="designPrimary"
              >
                {title}
              </Text>
              <Text variant="body/regular" centered color="designMuted">
                {message}
              </Text>
            </View>
            {promptError ? (
              <Text
                accessibilityRole="alert"
                variant="caption/regular"
                centered
                color="designNegative"
              >
                {promptError}
              </Text>
            ) : null}
            <View className="gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: isRegistering,
                  busy: isRegistering,
                }}
                disabled={isRegistering}
                onPress={requestNotifications}
                className="bg-design-accent min-h-14 flex-row items-center justify-center gap-3 rounded-full px-5 py-4 active:opacity-70"
              >
                {isRegistering ? (
                  <ActivityIndicator
                    color={isDark ? colors.background : colors.onImage}
                  />
                ) : null}
                <Text
                  variant="body/medium"
                  centered
                  color={isDark ? "designBackground" : "onImage"}
                  className="shrink"
                >
                  {confirmLabel}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: isRegistering }}
                disabled={isRegistering}
                onPress={close}
                className="min-h-12 items-center justify-center rounded-full px-5 py-3 active:opacity-60"
              >
                <Text variant="body/medium" centered color="designMuted">
                  Not now
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
