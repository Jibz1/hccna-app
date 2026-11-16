import { Predicate } from "effect";
import * as Haptics from "expo-haptics";
import { Tabs, useRouter } from "expo-router";
import { PlatformPressable } from "expo-router/react-navigation";
import type { ComponentProps } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { StyledBlurView as BlurView } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { cn } from "@/utils/styling";

const StyledPlatformPressable = withUniwind(PlatformPressable);

const EXCLUDED_ROUTES = new Set(["_sitemap", "+not-found"]);

type TabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

export function TabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
}: TabBarProps) {
  const router = useRouter();
  const { isDark, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const visibleRoutes = state.routes.filter(
    (route) => !EXCLUDED_ROUTES.has(route.name),
  );
  const mainRoutes = visibleRoutes.filter((route) => route.name !== "more");
  const moreRoute = visibleRoutes.find((route) => route.name === "more");

  function renderTab(route: (typeof state.routes)[number], separate = false) {
    const { options } = descriptors[route.key];
    const isFocused = state.routes[state.index].key === route.key;
    const color = isFocused
      ? (options.tabBarActiveTintColor ?? colors.text)
      : (options.tabBarInactiveTintColor ?? colors.textMuted);
    const label =
      options.tabBarAccessibilityLabel ??
      (Predicate.isString(options.tabBarLabel)
        ? options.tabBarLabel
        : (options.title ?? route.name));

    const onPress = () => {
      const event = emitter.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (!event.defaultPrevented && (separate || !isFocused)) {
        if (Platform.OS !== "web") {
          void Haptics.selectionAsync().catch(() => undefined);
        }
        if (separate) {
          router.navigate("/more-menu");
        } else {
          navigateToTab(route.key);
        }
      }
    };

    return (
      <StyledPlatformPressable
        key={route.key}
        accessibilityRole={separate ? "button" : "tab"}
        accessibilityState={separate ? undefined : { selected: isFocused }}
        accessibilityHint={separate ? "Opens the More menu" : undefined}
        accessibilityLabel={label}
        testID={`design-v2-tab-${route.name}`}
        onPress={onPress}
        onLongPress={() => {
          emitter.emit({ type: "tabLongPress", target: route.key });
        }}
        android_ripple={{ color: "transparent", borderless: false }}
        pressColor={colors.selected}
        pressOpacity={0.75}
        className={cn(
          "h-l items-center justify-center rounded-full overflow-hidden",
          separate ? "w-l" : "flex-1 min-w-[44px]",
          isFocused ? "bg-design-selected" : "bg-transparent",
        )}
      >
        {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
      </StyledPlatformPressable>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      style={{
        bottom: Math.max(insets.bottom, 16),
      }}
      className="gap-4xs absolute w-full max-w-[440px] flex-row items-center self-center px-[22px]"
    >
      <BlurView
        intensity={28}
        tint={isDark ? "dark" : "light"}
        className="shadow-tab-bar bg-design-chrome border-design-border h-[62px] flex-1 flex-row items-center justify-between overflow-hidden rounded-full border p-[6px]"
      >
        {mainRoutes.map((route) => renderTab(route))}
      </BlurView>
      {moreRoute ? (
        <BlurView
          intensity={28}
          tint={isDark ? "dark" : "light"}
          className="shadow-tab-bar bg-design-chrome border-design-border h-[62px] w-[62px] items-center justify-center overflow-hidden rounded-full border"
        >
          {renderTab(moreRoute, true)}
        </BlurView>
      ) : null}
    </View>
  );
}
