import { Stack } from "expo-router";

import { useAppTheme } from "@/theme/useAppTheme";

export default function Layout() {
  const { colors } = useAppTheme();
  return (
    <Stack
      screenOptions={{
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
  );
}
