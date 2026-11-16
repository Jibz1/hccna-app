import { useRouter } from "expo-router";
import { PressableScale } from "pressto";
import { View } from "react-native";

import { CampusStreamButton } from "@/components/live/CampusStreamButton";
import { AccountAvatar } from "@/components/profile/AccountAvatar";
import SvgHcclogo from "@/icons/Hcclogo";

export function LiveStream() {
  const { navigate } = useRouter();

  return (
    <>
      <PressableScale
        onPress={() => {
          navigate(`/`);
        }}
        accessibilityLabel="Navigate to home"
        accessibilityRole="button"
        accessibilityHint="Returns to the home screen"
      >
        <SvgHcclogo
          className="text-content-primary rounded-full"
          height={32}
          width={32}
        />
      </PressableScale>

      <View className="gap-5xs flex-row items-center justify-end">
        <CampusStreamButton />
        <AccountAvatar size="s" />
      </View>
    </>
  );
}
