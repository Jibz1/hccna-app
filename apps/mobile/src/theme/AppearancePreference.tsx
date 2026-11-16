import { Pressable, View } from "react-native";

import { usePreferencesTheme } from "@/theme/usePreferencesTheme";
import { Text } from "@/ui/Text";
import { DevicePrefs } from "@/utils/devicePrefs";
import type { DynamicTheme } from "@/utils/devicePrefsSchema";
import { cn } from "@/utils/styling";

const appearanceOptions = [
  { label: "System", value: "auto" },
  { label: "Light", value: "purple-light" },
  { label: "Dark", value: "purple-dark" },
] as const satisfies readonly { label: string; value: DynamicTheme }[];

export function AppearancePreference({
  showTitle = true,
  compact = false,
}: {
  showTitle?: boolean;
  compact?: boolean;
}) {
  const preference = usePreferencesTheme();

  return (
    <View
      className={cn(
        "gap-4xs bg-design-surface border-continuous rounded-3xl",
        compact ? "p-2" : "p-3xs",
      )}
    >
      {showTitle ? (
        <Text variant="headingXs/medium" color="designPrimary">
          Appearance
        </Text>
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Appearance"
        className="gap-5xs flex-row"
      >
        {appearanceOptions.map(({ label, value }) => {
          const selected = preference === value;

          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={`${label} theme`}
              accessibilityState={{
                checked: selected,
              }}
              aria-checked={selected}
              className={cn(
                "py-4xs min-h-12 flex-1 items-center justify-center rounded-full active:opacity-70",
                compact ? "px-2" : "px-4xs",
                selected ? "bg-design-selected" : "bg-transparent",
                "border-design-border border",
              )}
              onPress={() => {
                if (value !== preference) {
                  DevicePrefs.setTheme(value);
                }
              }}
            >
              <Text
                variant={selected ? "labelSm/medium" : "labelSm/regular"}
                color={selected ? "designPrimary" : "designMuted"}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
