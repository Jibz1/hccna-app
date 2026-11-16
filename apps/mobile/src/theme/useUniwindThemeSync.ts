import { useEffect, useLayoutEffect } from "react";
import { Appearance, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import { mapDynamicThemeToUniwind } from "@/theme/preference";
import type { DynamicTheme } from "@/utils/devicePrefsSchema";

export function useUniwindThemeSync(
  theme: DynamicTheme,
  appliedSystemIsDark?: boolean,
) {
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    const hasAppliedSystemTheme =
      theme === "auto" && appliedSystemIsDark !== undefined;
    const uniwindTheme = hasAppliedSystemTheme
      ? appliedSystemIsDark
        ? "dark"
        : "light"
      : mapDynamicThemeToUniwind(theme);
    Uniwind.setTheme(uniwindTheme);
    if (hasAppliedSystemTheme && Platform.OS !== "web") {
      // Uniwind must follow the applied snapshot rather than its own immediate
      // system listener. Release its native override so useColorScheme keeps
      // observing the OS and can schedule the next shared palette update.
      Appearance.setColorScheme("unspecified");
    }
  }, [theme, appliedSystemIsDark]);

  useEffect(() => {
    Uniwind.updateInsets(insets);
  }, [insets]);
}
