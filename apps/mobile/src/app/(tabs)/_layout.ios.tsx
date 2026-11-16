import { useRouter } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { StatusBar } from "expo-status-bar";
import { Platform, type ViewStyle } from "react-native";

import { useAppTheme } from "@/theme/useAppTheme";

export const unstable_settings = {
  anchor: "index",
};

export default function TabLayout() {
  const router = useRouter();
  const isPad = Platform.OS === "ios" && Platform.isPad;
  const { isDark, colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const defaultTabContentStyle = {
    backgroundColor: colors.background,
    experimental_backgroundImage: `linear-gradient(to bottom, ${backgroundGradient
      .map(
        (color, index) =>
          `${color} ${backgroundGradientLocations[index] * 100}%`,
      )
      .join(", ")})`,
  } satisfies Pick<
    ViewStyle,
    "backgroundColor" | "experimental_backgroundImage"
  >;

  return (
    <NativeTabs
      sidebarAdaptable
      backBehavior="history"
      disableTransparentOnScrollEdge
      labelVisibilityMode="unlabeled"
      minimizeBehavior="onScrollDown"
      blurEffect={
        isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"
      }
      unstable_nativeProps={{
        colorScheme: isDark ? "dark" : "light",
        // iOS 27 detaches only the prominent tab. Keep the iPhone More
        // action on its own glass button, as iOS 26 does for search tabs.
        ios: { prominentScreenKey: isPad ? undefined : "more" },
      }}
      // UIKit also uses this tint as the sidebar selection background. Let
      // the system pair that background with its selected label on iPad.
      tintColor={isPad ? undefined : colors.text}
      iconColor={{ default: colors.textMuted, selected: colors.text }}
      backgroundColor={colors.chrome}
      screenListeners={({ route }) => ({
        focus: () => {
          // The development build uses application-managed status bars. Native
          // tab transitions can reset their style even when React props match.
          requestAnimationFrame(() => {
            StatusBar.setStyle(
              isDark || route.name === "events" ? "light" : "dark",
            );
          });
        },
      })}
    >
      <NativeTabs.Trigger
        name="index"
        accessibilityLabel="Home"
        contentStyle={defaultTabContentStyle}
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: "house", selected: "house.fill" }}
          md={{ default: "home", selected: "home" }}
        />
        <NativeTabs.Trigger.Label hidden={!isPad}>
          Home
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="events"
        accessibilityLabel="Events"
        contentStyle={defaultTabContentStyle}
      >
        <NativeTabs.Trigger.Icon
          sf="calendar"
          md={{ default: "calendar_month", selected: "calendar_month" }}
        />

        <NativeTabs.Trigger.Label hidden={!isPad}>
          Events
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="sermons"
        accessibilityLabel="Sermons"
        contentStyle={defaultTabContentStyle}
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: "book", selected: "book.fill" }}
          md={{ default: "auto_stories", selected: "auto_stories" }}
        />
        <NativeTabs.Trigger.Label hidden={!isPad}>
          Sermons
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="give"
        accessibilityLabel="Giving"
        contentStyle={defaultTabContentStyle}
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: "gift", selected: "gift.fill" }}
          md={{
            default: "volunteer_activism",
            selected: "volunteer_activism",
          }}
        />
        <NativeTabs.Trigger.Label hidden={!isPad}>
          Giving
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/* iPad keeps More selectable so the native indicator does not spring
          back to the previous tab. Its screen provides the submenu button. */}
      <NativeTabs.Trigger
        name="more"
        disabled={!isPad}
        listeners={
          isPad
            ? undefined
            : {
                tabPress: ({ data }) => {
                  // Only a real tap on this disabled tab emits a prevented event.
                  // Do not drop this gate: JS navigation to /more (dismissTo from
                  // the menu) is filtered upstream as programmatic-js, but UIKit
                  // echoes the resulting selection back as a user action (via
                  // react-native-screens' UITab delegate on iOS 26.1+), which
                  // lands here with isPrevented false and used to reopen the
                  // menu. The screens patch emits the prevented event even when
                  // More is already selected.
                  if (data.isPrevented) {
                    router.navigate("/more-menu");
                  }
                },
              }
        }
        role={isPad ? undefined : "search"}
        accessibilityLabel="More"
        testID="design-v2-tab-more"
        contentStyle={defaultTabContentStyle}
      >
        {/* Keep the three-dot shape when selected; the accent tint indicates
            the active screen inside the separate native glass button. */}
        <NativeTabs.Trigger.Icon
          sf="ellipsis"
          md={{ default: "more_horiz", selected: "more_horiz" }}
          selectedColor={colors.accent}
        />
        <NativeTabs.Trigger.Label hidden={!isPad}>
          More
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
