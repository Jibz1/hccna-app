import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import { AppearancePreference } from "@/theme/AppearancePreference";
import { usePreferencesTheme } from "@/theme/usePreferencesTheme";

import { MoreRow, MoreSection } from "./MoreSection";

export function MorePreferences() {
  const router = useRouter();
  const campus = usePreferredCampus();
  const preference = usePreferencesTheme();
  const [appearanceExpanded, setAppearanceExpanded] = useState(false);
  const appearance =
    preference === "auto"
      ? "System"
      : preference === "purple-dark"
        ? "Dark"
        : "Light";

  return (
    <MoreSection title="Make it yours">
      <MoreRow
        title="Saved verses"
        subtitle="Revisit the scriptures you’ve saved"
        icon="bookmark"
        onPress={() => {
          router.navigate("/saved-verses");
        }}
      />
      <MoreRow
        title="My campus"
        subtitle={campus.campusName}
        icon="church"
        onPress={() => {
          router.navigate("/preferences");
        }}
      />
      <MoreRow
        title="Appearance"
        subtitle={appearance}
        icon="palette"
        expanded={appearanceExpanded}
        last
        onPress={() => {
          setAppearanceExpanded((expanded) => !expanded);
        }}
      />
      {appearanceExpanded ? (
        <View className="px-3 pb-3">
          <AppearancePreference showTitle={false} compact />
        </View>
      ) : null}
    </MoreSection>
  );
}
