import { getAnalytics, logScreenView } from "@react-native-firebase/analytics";
import {
  DarkTheme,
  DefaultTheme,
  useGlobalSearchParams,
  type NativeStackNavigationOptions,
  usePathname,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";

import Stack from "@/components/navigation/Stack";
import { PushNotificationPrompt } from "@/components/notifications/PushNotificationPrompt";
import { ThemePreference } from "@/components/profile/ThemePreference";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { StyledGestureHandlerRootView as GestureHandlerRootView } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { ConnectivityToast } from "@/ui/toast/ConnectivityToast";
import { Toaster } from "@/ui/toast/Toaster";
import { scheduleIdleTask } from "@/utils/scheduleIdleTask";
import { statsig } from "@/utils/statsig";

export const unstable_settings = {
  anchor: "(tabs)",
};

const getModalScreenOptions = (
  backgroundColor: string,
): NativeStackNavigationOptions => {
  return {
    presentation: "modal",
    headerShown: false,
    headerBackVisible: true,
    headerTransparent: true,
    headerTitleAlign: "center",
    headerStyle: { backgroundColor },
    //animation: "slide_from_bottom",
    ...Platform.select({ ios: { animation: "slide_from_bottom" as const } }),
    headerShadowVisible: false,
  } as const;
};

const rootStackScreenOptions = { headerShown: false } as const;

function RouteAnalytics() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  useEffect(() => {
    const task = scheduleIdleTask(() => {
      const screenName = pathname === "/" ? "home" : pathname;
      logScreenView(getAnalytics(), {
        screen_name: screenName,
        screen_class: screenName,
        screen_params: JSON.stringify(params),
      }).catch(console.error);

      statsig.logEvent(
        "screen_view",
        screenName,
        params
          ? Object.fromEntries(
              Object.entries(params).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : {},
      );
    });

    return () => {
      task.cancel();
    };
  }, [pathname, params]);

  return null;
}

function useAppStatusBarStyle() {
  const pathname = usePathname();
  const { isDark } = useAppTheme();

  return isDark ||
    pathname === "/events" ||
    pathname === "/youtube-modal" ||
    pathname === "/vod-detail-modal"
    ? "light"
    : "dark";
}

export default function BaseRoutes() {
  const { isDark, colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const statusBarStyle = useAppStatusBarStyle();
  useEffect(() => {
    // The existing iOS development build uses app-managed status bars. Apply
    // after the native tabs update their appearance, and again on transitions.
    const frame = requestAnimationFrame(() => {
      StatusBar.setStyle(statusBarStyle);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [statusBarStyle]);
  // For now we don't want to show the live stream modal. we need to rethink this.
  // useEventLive();

  const modalScreenOptions = getModalScreenOptions(colors.background);
  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.background,
      card: colors.surfaceStrong,
      text: colors.text,
      primary: colors.accent,
      border: colors.border,
    },
  };

  return (
    <ThemeProvider
      value={navigationTheme}
      backgroundGradientColors={backgroundGradient}
      backgroundGradientLocations={backgroundGradientLocations}
      backgroundGradientVertical={!isDark}
    >
      <RouteAnalytics />
      <StatusBar style={statusBarStyle} />
      <ThemePreference>
        <GestureHandlerRootView className="flex-1">
          <Stack
            screenOptions={rootStackScreenOptions}
            screenListeners={{
              transitionEnd: () => {
                StatusBar.setStyle(statusBarStyle);
              },
            }}
          >
            <Stack.Screen
              name="(tabs)"
              options={{
                headerShown: false,
                sheetAllowedDetents: [0.25],
              }}
            />

            <Stack.Screen
              name="event-modal"
              options={{
                title: "Event detail",
                ...modalScreenOptions,
              }}
            />
            <Stack.Screen
              name="campus-modal"
              options={{
                title: "Campus detail",
                ...modalScreenOptions,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="thought-of-god"
              options={{
                title: "Thought of God",
                ...modalScreenOptions,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="yearly-giving-modal"
              options={{
                title: "Yearly Giving",
                ...modalScreenOptions,
              }}
            />
            <Stack.Screen
              name="castr-stream"
              options={{
                title: "Castr Stream",
                ...modalScreenOptions,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="check-in"
              options={{
                title: "Check In",
                ...modalScreenOptions,
              }}
            />
            <Stack.Screen
              name="export-event-attendance"
              options={{
                title: "Export Event Attendance",
                ...modalScreenOptions,
              }}
            />
            <Stack.Screen
              name="youtube-modal"
              options={{
                title: "Sermon detail",
                headerTitleAlign: "center",
                presentation: "modal",
                headerShown: false,
                headerBackVisible: false,
                ...Platform.select({
                  ios: { animation: "slide_from_bottom" as const },
                }),
              }}
            />
            <Stack.Screen
              name="vod-detail-modal"
              options={{
                presentation: "fullScreenModal",
                title: "Verse of the Day",
                headerTitleAlign: "center",

                headerShown: false,
                headerBackVisible: false,

                gestureDirection: "vertical",
                animation: "slide_from_bottom",
              }}
            />

            {/* <Stack.Screen
              name="account-modal"
              options={{
                presentation: "modal",
                
                headerShown: false,
                headerBackVisible: true,
                headerTransparent: true,
                headerTitleAlign: "center",
                headerStyle: {
                  backgroundColor: themedBackgroundColors["purple-light"],
                },
                animation: "slide_from_bottom",

                headerShadowVisible: false,
              }}
            /> */}
            {/* <Stack.Screen
              name="create-email-account"
              options={{
                presentation: "modal",
                ...(Platform.OS === "ios"
                  ? { animation: "slide_from_bottom" }
                  : {}),
                headerShown: false,
                headerBackVisible: true,
                headerTransparent: true,
                headerTitleAlign: "center",
                headerStyle: {
                  backgroundColor: themedBackgroundColors["purple-light"],
                },

                headerShadowVisible: false,
              }}
            /> */}
            <Stack.Screen
              name="profile"
              options={{
                title: "Profile",
                headerShown: false,
                ...Platform.select({ android: { animation: "none" as const } }),
              }}
            />
            <Stack.Screen
              name="ministry-tools"
              options={{
                title: "Ministry Tools",
                headerShown: false,
                ...Platform.select({ android: { animation: "none" as const } }),
              }}
            />
            <Stack.Screen
              name="edit-profile"
              options={{
                presentation: "modal",
                ...Platform.select({
                  ios: { animation: "slide_from_bottom" as const },
                }),
                headerShown: false,
                headerBackVisible: true,
                headerTransparent: true,
                headerTitleAlign: "center",
                headerStyle: {
                  backgroundColor: colors.background,
                },

                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="saved-verses"
              options={{ title: "Saved verses", headerShown: false }}
            />
            <Stack.Screen
              name="preferences"
              options={{
                title: "Campus",
                ...modalScreenOptions,
              }}
            />
            <Stack.Screen
              name="notifications"
              options={{
                title: "Notifications",
                ...modalScreenOptions,
              }}
            />
            <Stack.Screen
              name="permissions"
              options={{
                title: "Permissions",
                ...modalScreenOptions,
              }}
            />
            <Stack.Screen
              name="whats-new"
              options={{
                title: "What’s New",
                ...modalScreenOptions,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="more-menu"
              options={{
                presentation: "transparentModal",
                // The submenu animates its own surface without fading native glass.
                animation: "none",
                gestureEnabled: false,
                headerShown: false,
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
            <Stack.Screen
              name="forms"
              options={{ title: "Connect & Resources", ...modalScreenOptions }}
            />

            <Stack.Screen
              name="account-modal-stack"
              options={{
                presentation: "fullScreenModal",
                headerShown: false,
                headerBackVisible: false,
                gestureDirection: "vertical",
                animation: "slide_from_bottom",
              }}
            />
            <Stack.Screen
              name="delete-account"
              options={{
                presentation: "fullScreenModal",
                title: "Delete Account",
                headerShown: false,
                animation: "slide_from_bottom",
              }}
            />
            <Stack.Screen
              name="delete-account-confirmation"
              options={{
                presentation: "fullScreenModal",
                title: "Delete Account Confirmation",
                headerShown: false,
                animation: "slide_from_bottom",
              }}
            />
          </Stack>
          <PushNotificationPrompt />
          <Toaster />
          <ConnectivityToast />
        </GestureHandlerRootView>
      </ThemePreference>
    </ThemeProvider>
  );
}
