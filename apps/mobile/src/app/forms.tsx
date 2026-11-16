import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConnectionResources } from "@/components/connect/ConnectionResources";
import { CCBForm } from "@/components/forms/CCBForms";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";

export default function ConnectResourcesScreen() {
  const { isDark, colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View className="bg-design-background flex-1">
      {!isDark ? (
        <LinearGradient
          pointerEvents="none"
          colors={backgroundGradient}
          locations={backgroundGradientLocations}
          className="absolute inset-0"
        />
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerClassName="grow items-center px-[22px]"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <View className="w-full max-w-[540px] gap-[22px]">
          <View className="flex-row items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back from Connect & Resources"
              onPress={() => {
                goBackOrReplace("/more");
              }}
              className="bg-design-surface h-[44px] w-[44px] items-center justify-center rounded-full active:opacity-60"
            >
              <FontAwesome6 name="chevron-left" size={18} color={colors.text} />
            </Pressable>
            <Text
              accessibilityRole="header"
              className="flex-1"
              color="designPrimary"
              variant="bodyLg/bold"
              centered
            >
              Connect & Resources
            </Text>
            <View className="w-[44px]" />
          </View>
          <ConnectionResources />
          <CCBForm />
        </View>
      </ScrollView>
    </View>
  );
}
