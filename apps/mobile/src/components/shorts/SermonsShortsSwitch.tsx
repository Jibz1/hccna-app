import { Pressable, View } from "react-native";

import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export type SermonsTabMode = "sermons" | "shorts";

const segments: readonly { mode: SermonsTabMode; label: string }[] = [
  { mode: "sermons", label: "Sermons" },
  { mode: "shorts", label: "Shorts" },
];

export function SermonsShortsSwitch({
  value,
  onChange,
}: {
  value: SermonsTabMode;
  onChange: (mode: SermonsTabMode) => void;
}) {
  return (
    // The track is opaque because the switch floats over the sermons hero.
    <View
      accessibilityRole="tablist"
      className="border-continuous border-design-border bg-design-surface flex-row self-center rounded-full border p-1"
    >
      {segments.map(({ mode, label }) => {
        const selected = mode === value;
        return (
          <Pressable
            key={mode}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) {
                onChange(mode);
              }
            }}
            className={cn(
              "min-h-11 items-center justify-center rounded-full px-5 py-2.5 active:opacity-70",
              selected && "bg-design-text",
            )}
          >
            <Text
              variant="caption/medium"
              color={selected ? "designBackground" : "designMuted"}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
