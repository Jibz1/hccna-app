import { router } from "expo-router";

import { ProfileSettingsRow } from "@/components/profile/ProfileSettingsRow";
import { useUserProfile } from "@/hooks/relay/useUserData";

export function DeleteAccountButton() {
  const user = useUserProfile();
  if (!user) {
    return null;
  }

  return (
    <ProfileSettingsRow
      title="Delete account"
      icon="trash-can"
      destructive
      last
      onPress={() => {
        router.push("/delete-account");
      }}
    />
  );
}
