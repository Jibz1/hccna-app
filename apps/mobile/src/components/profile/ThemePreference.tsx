import { ReactNode } from "react";
import { View } from "react-native";

export function ThemePreference({ children }: { children: ReactNode }) {
  return <View className="flex-1">{children}</View>;
}
