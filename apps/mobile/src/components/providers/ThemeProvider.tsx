import { ThemeProvider as NavigationThemeProvider } from "expo-router";
import type { Theme } from "expo-router/react-navigation";
import { ReactNode } from "react";
import { View } from "react-native";
import { ScopedTheme } from "uniwind";

import { StyledLinearGradient as LinearGradient } from "@/cssInterop";

type AppThemeProviderProps = {
  value: Theme;
  children: ReactNode;
  backgroundGradientColors?: readonly [string, string, ...string[]];
  backgroundGradientLocations?: readonly [number, number, ...number[]];
  backgroundGradientVertical?: boolean;
};

export function ThemeProvider({
  value,
  children,
  backgroundGradientColors,
  backgroundGradientLocations,
  backgroundGradientVertical = false,
}: AppThemeProviderProps) {
  const navigationTheme = backgroundGradientColors
    ? {
        ...value,
        colors: {
          ...value.colors,
          background: "transparent",
        },
      }
    : value;

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <ScopedTheme theme={value.dark ? "dark" : "light"}>
        <View className="flex-1">
          {backgroundGradientColors ? (
            <LinearGradient
              colors={backgroundGradientColors}
              locations={backgroundGradientLocations}
              start={{
                x: backgroundGradientVertical ? 0.5 : 0,
                y: 0,
              }}
              end={{
                x: backgroundGradientVertical ? 0.5 : 1,
                y: 1,
              }}
              pointerEvents="none"
              className="absolute inset-0"
            />
          ) : null}
          {children}
        </View>
      </ScopedTheme>
    </NavigationThemeProvider>
  );
}
