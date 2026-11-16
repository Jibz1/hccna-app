import { View } from "react-native";

import { LoadingIndicator } from "@/ui/LoadingIndicator";

export function FullLoadingState() {
  return (
    <View className="p-3xs pt-m flex-1 items-center">
      <LoadingIndicator spinnerClassName="text-content-persistentBlack" />
    </View>
  );
}
