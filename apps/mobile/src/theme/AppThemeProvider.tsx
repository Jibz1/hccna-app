import {
  startTransition,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Appearance, useColorScheme } from "react-native";

import { AppThemeContext } from "@/theme/useAppTheme";
import { usePreferencesTheme } from "@/theme/usePreferencesTheme";
import { useUniwindThemeSync } from "@/theme/useUniwindThemeSync";

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const preference = usePreferencesTheme();
  const systemScheme = useColorScheme();
  const isDark =
    preference === "purple-dark" ||
    (preference === "auto" && systemScheme === "dark");
  const requestedTheme = useMemo(
    () => ({ preference, isDark }),
    [preference, isDark],
  );
  const [appliedTheme, setAppliedTheme] = useState(requestedTheme);

  useEffect(() => {
    if (
      appliedTheme.preference === requestedTheme.preference &&
      appliedTheme.isDark === requestedTheme.isDark
    ) {
      return;
    }

    // Give the selected option a frame before restyling the navigation tree.
    // A newer selection cancels the pending frame; no fixed delay is needed.
    const frame = requestAnimationFrame(() => {
      // The system may have changed since this frame was scheduled.
      const nextTheme =
        requestedTheme.preference === "auto"
          ? {
              ...requestedTheme,
              isDark: Appearance.getColorScheme() === "dark",
            }
          : requestedTheme;
      startTransition(() => {
        setAppliedTheme(nextTheme);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [appliedTheme, requestedTheme]);
  useUniwindThemeSync(appliedTheme.preference, appliedTheme.isDark);
  // Selecting System need not repaint consumers if the resolved palette matches.
  const palette = useMemo(
    () => ({ isDark: appliedTheme.isDark }),
    [appliedTheme.isDark],
  );

  return <AppThemeContext value={palette}>{children}</AppThemeContext>;
}
