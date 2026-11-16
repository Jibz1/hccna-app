import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { useAuthenticatedUid } from "@/hooks/relay/useUserData";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

export function HomeSignInNudge() {
  const { navigate } = useRouter();
  const { colors } = useAppTheme();
  const authenticatedUid = useAuthenticatedUid();
  const [dismissed, setDismissed] = useState(false);

  if (authenticatedUid || dismissed) {
    return null;
  }

  return (
    <View className="mx-2xs border-continuous border-design-border bg-design-surface flex-row items-center overflow-hidden rounded-xl border">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign in or sign up"
        accessibilityHint="Opens the account sign-in and registration screen"
        onPress={() => {
          navigate("/account-modal-stack");
        }}
        className="gap-4xs min-h-14 flex-1 flex-row items-center py-3 pr-2 pl-4 active:opacity-70"
      >
        <Text variant="caption/regular" color="designMuted" className="flex-1">
          Make yourself at home
        </Text>
        <View className="flex-row items-center gap-1.5">
          <Text variant="caption/medium" color="designAccent">
            Sign in
          </Text>
          <FontAwesome6 name="arrow-right" size={12} color={colors.accent} />
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss sign-in reminder"
        onPress={() => {
          setDismissed(true);
        }}
        className="active:bg-design-selected size-11 items-center justify-center rounded-full"
      >
        <FontAwesome6 name="xmark" size={14} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}
