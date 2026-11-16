import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { atom, useAtom } from "jotai";
import { Pressable, View } from "react-native";

import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import { useAuthenticatedUid } from "@/hooks/relay/useUserData";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";

// In memory only: the prompt returns on the next launch, or for another account.
const dismissedUidsAtom = atom<ReadonlySet<string>>(new Set<string>());

export function HomeCampusBanner() {
  const { navigate } = useRouter();
  const { colors } = useAppTheme();
  const campus = usePreferredCampus();
  const uid = useAuthenticatedUid();
  const [dismissedUids, setDismissedUids] = useAtom(dismissedUidsAtom);

  if (
    !uid ||
    dismissedUids.has(uid) ||
    !campus.isLoaded ||
    campus.hasSavedCampus
  ) {
    return null;
  }

  return (
    // Sibling buttons keep the dismiss control reachable by screen readers.
    <View className="border-continuous border-design-accent/30 bg-design-selected shadow-tab-bar flex-row items-center rounded-xl border">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next steps: Choose a campus"
        accessibilityHint="Opens campus preferences for your events, livestreams, and giving"
        onPress={() => {
          navigate("/preferences");
        }}
        className="min-h-14 min-w-0 flex-1 flex-row items-center gap-3 py-3 pl-4 active:opacity-70"
      >
        <FontAwesome6 name="location-dot" size={20} color={colors.accent} />
        <View className="min-w-0 flex-1 gap-1">
          <Text
            variant="caption/medium"
            color="designAccent"
            transform="uppercase"
            className="tracking-[1.5px]"
          >
            Next steps
          </Text>
          <Text variant="labelSm/medium" color="designPrimary">
            Choose a campus
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss campus reminder"
        hitSlop={8}
        onPress={() => {
          setDismissedUids((uids) => new Set([...uids, uid]));
        }}
        className="mr-2 h-9 w-9 items-center justify-center rounded-full active:opacity-70"
      >
        <FontAwesome6 name="xmark" size={14} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}
