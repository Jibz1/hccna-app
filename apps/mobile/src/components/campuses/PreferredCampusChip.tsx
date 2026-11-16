import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Effect, Semaphore } from "effect";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { useSavePreferredCampus } from "@/hooks/profile/useSavePreferredCampus";
import type { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { cn } from "@/utils/styling";

const CHIP_CLASS_NAME =
  "flex-row items-center gap-1.5 self-start rounded-full px-3 py-1.5";

/** Header chip: "My campus" on the saved campus, a save action on every other campus. */
export function PreferredCampusChip({
  campusSlug,
  campusName,
  isPreferred,
  preferredCampus,
}: {
  campusSlug: string;
  campusName: string;
  isPreferred: boolean;
  preferredCampus: ReturnType<typeof usePreferredCampus>;
}) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { save, isSaving } = useSavePreferredCampus();
  const [saveLock] = useState(() => Semaphore.makeUnsafe(1));
  const disabled = isSaving || !preferredCampus.isLoaded;

  if (isPreferred) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel="My campus"
        className={cn("bg-design-selected", CHIP_CLASS_NAME)}
      >
        <FontAwesome6 name="star" solid size={12} color={colors.accent} />
        <Text variant="labelXs/medium" color="designPrimary">
          My campus
        </Text>
      </View>
    );
  }

  const handlePress = () => {
    if (disabled) {
      return;
    }
    if (!preferredCampus.isAuthenticated) {
      router.push("/account-modal-stack");
      return;
    }

    Effect.tryPromise(() => save(campusSlug, preferredCampus.version)).pipe(
      Effect.matchEffect({
        onSuccess: () =>
          Effect.sync(() => {
            toast.success({
              title: "Campus saved",
              message: `${campusName} is now your campus.`,
            });
          }),
        onFailure: ({ cause }) =>
          Effect.sync(() => {
            toast.error({
              title: "Couldn't save your campus",
              message:
                cause instanceof Error ? cause.message : "Please try again.",
            });
          }),
      }),
      saveLock.withPermitsIfAvailable(1),
      Effect.runFork,
    );
  };

  const label = !preferredCampus.isAuthenticated
    ? "Sign in to choose your campus"
    : isSaving
      ? "Saving campus…"
      : "Make this my campus";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: isSaving }}
      disabled={disabled}
      onPress={handlePress}
      hitSlop={8}
      className={cn(
        "border-design-border border active:opacity-70",
        CHIP_CLASS_NAME,
        disabled && "opacity-40",
      )}
    >
      {isSaving ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <FontAwesome6 name="star" size={12} color={colors.accent} />
      )}
      <Text variant="labelXs/medium" color="designPrimary">
        {label}
      </Text>
    </Pressable>
  );
}
