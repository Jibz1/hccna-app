import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { useRouter } from "expo-router";
import { Suspense, useState, type ComponentProps } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useMoreMenuMotion } from "@/components/navigation/useMoreMenuMotion";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import { useMinistryToolsAccess } from "@/hooks/relay/useMinistryToolsAccess";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { AppearancePreference } from "@/theme/AppearancePreference";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

const MORE_BUTTON_SIZE = 62;

function MenuItem({
  title,
  icon,
  onPress,
  expanded,
}: {
  title: string;
  icon: ComponentProps<typeof FontAwesome6>["name"];
  onPress: () => void;
  expanded?: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      className="active:bg-design-selected min-h-[48px] flex-row items-center gap-3 rounded-2xl px-3 py-3"
    >
      <View className="w-5 items-center">
        <FontAwesome6 name={icon} size={16} color={colors.textMuted} />
      </View>
      <Text variant="body/medium" color="designPrimary" className="flex-1">
        {title}
      </Text>
      {expanded !== undefined ? (
        <FontAwesome6
          name={expanded ? "chevron-down" : "chevron-right"}
          size={11}
          color={colors.textMuted}
        />
      ) : null}
    </Pressable>
  );
}

function MinistryToolsMenuItem() {
  const router = useRouter();
  const { hasAccess } = useMinistryToolsAccess();

  if (!hasAccess) {
    return null;
  }

  return (
    <MenuItem
      title="Ministry Tools"
      icon="toolbox"
      onPress={() => {
        router.replace("/ministry-tools");
      }}
    />
  );
}

export default function MoreMenu() {
  const router = useRouter();
  const user = useUserProfile();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const isPad = Platform.OS === "ios" && Platform.isPad;
  const transformOrigin = isPad ? "center" : "bottom right";
  const hasNativeGlass =
    Platform.OS === "ios" &&
    isLiquidGlassAvailable() &&
    isGlassEffectAPIAvailable();
  const MenuSurface = hasNativeGlass ? GlassView : View;
  const {
    onMenuLayout,
    surfaceStyle,
    contentContainerStyle,
    contentStyle,
    ellipsisStyle,
    closeStyle,
    backdropStyle,
  } = useMoreMenuMotion(MORE_BUTTON_SIZE);
  const [appearanceExpanded, setAppearanceExpanded] = useState(false);
  const close = () => {
    goBackOrReplace("/");
  };

  return (
    <View
      className="flex-1"
      accessibilityViewIsModal
      onAccessibilityEscape={close}
    >
      <Animated.View style={backdropStyle} className="absolute inset-0">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss More menu"
          onPress={close}
          className={cn(
            "absolute inset-0",
            isPad ? "bg-black/25" : "bg-black/5",
          )}
        />
      </Animated.View>
      <View
        pointerEvents="box-none"
        className={cn(
          "w-full max-w-[440px] flex-1 self-center px-[22px]",
          isPad ? "items-center justify-center" : "items-end justify-end",
        )}
        style={{
          paddingTop: insets.top + 16,
          // UIKit's floating tab bar sits 14pt below the safe-area baseline.
          paddingBottom:
            Platform.OS === "ios" && hasNativeGlass && !isPad
              ? Math.max(insets.bottom - 14, 8)
              : Math.max(insets.bottom, 16),
        }}
      >
        <View
          onLayout={onMenuLayout}
          style={{
            width: isPad ? 360 : 300,
            maxWidth: "100%",
            maxHeight: "100%",
          }}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { transformOrigin, overflow: "hidden" },
              surfaceStyle,
            ]}
          >
            <MenuSurface
              {...(hasNativeGlass
                ? {
                    glassEffectStyle: "regular" as const,
                    colorScheme: isDark
                      ? ("dark" as const)
                      : ("light" as const),
                  }
                : {})}
              style={{ flex: 1, borderRadius: 28 }}
              className={
                hasNativeGlass
                  ? undefined
                  : "bg-design-surface-strong border-design-border border"
              }
            />
          </Animated.View>
          <Animated.View
            style={[
              {
                flexShrink: 1,
                overflow: "hidden",
                transformOrigin,
              },
              surfaceStyle,
            ]}
          >
            <Animated.View
              style={[
                { flexShrink: 1, transformOrigin },
                contentContainerStyle,
              ]}
            >
              <Animated.View style={[{ flexShrink: 1 }, contentStyle]}>
                <View className="px-5 pt-4 pb-2">
                  <Text
                    accessibilityRole="header"
                    variant="labelSm/medium"
                    color="designMuted"
                  >
                    More
                  </Text>
                </View>
                <ScrollView
                  bounces={false}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 8 }}
                >
                  {!isPad ? (
                    <MenuItem
                      title="More section"
                      icon="ellipsis"
                      onPress={() => {
                        router.dismissTo("/more");
                      }}
                    />
                  ) : null}
                  <MenuItem
                    title="Preferences"
                    icon="sliders"
                    onPress={() => {
                      router.replace("/profile");
                    }}
                  />
                  <MenuItem
                    title="Campus Selection"
                    icon="church"
                    onPress={() => {
                      router.replace("/preferences");
                    }}
                  />
                  <MenuItem
                    title="Appearance"
                    icon="palette"
                    expanded={appearanceExpanded}
                    onPress={() => {
                      setAppearanceExpanded((expanded) => !expanded);
                    }}
                  />
                  {appearanceExpanded ? (
                    <AppearancePreference showTitle={false} compact />
                  ) : null}
                  <MenuItem
                    title="Connect & Resources"
                    icon="people-group"
                    onPress={() => {
                      router.replace("/forms");
                    }}
                  />
                  {user ? (
                    <ErrorBoundaryWithRetry
                      key={user.uid}
                      fallbackRender={() => null}
                    >
                      <Suspense fallback={null}>
                        <MinistryToolsMenuItem />
                      </Suspense>
                    </ErrorBoundaryWithRetry>
                  ) : null}
                </ScrollView>
              </Animated.View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close More menu"
                onPress={close}
                className="active:bg-design-selected items-center justify-center self-end rounded-full"
                style={{ width: MORE_BUTTON_SIZE, height: MORE_BUTTON_SIZE }}
              >
                <Animated.View style={ellipsisStyle} className="absolute">
                  <FontAwesome6 name="ellipsis" size={22} color={colors.text} />
                </Animated.View>
                <Animated.View style={closeStyle}>
                  <FontAwesome6 name="xmark" size={20} color={colors.text} />
                </Animated.View>
              </Pressable>
            </Animated.View>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
