import { Stack as NativeStack } from "expo-router";
import type { ComponentProps } from "react";
import { Platform } from "react-native";

type NativeStackNavigationOptions = Exclude<
  NonNullable<ComponentProps<typeof NativeStack>["screenOptions"]>,
  (...args: any[]) => any
>;

// These are the default stack options for iOS, they disable on other platforms.
export const DEFAULT_STACK_HEADER: NativeStackNavigationOptions =
  Platform.OS !== "ios"
    ? {}
    : {
        headerTransparent: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerLargeStyle: {
          backgroundColor: "transparent",
        },
        headerLargeTitle: true,
      };

/** Create a bottom sheet on iOS with extra snap points (`sheetAllowedDetents`) */
export const BOTTOM_SHEET: NativeStackNavigationOptions = {
  // https://github.com/software-mansion/react-native-screens/blob/main/native-stack/README.md#sheetalloweddetents
  presentation: "formSheet",
  gestureDirection: "vertical",
  animation: "slide_from_bottom",
  sheetGrabberVisible: true,
  sheetInitialDetentIndex: 0,
  sheetAllowedDetents: [0.5, 1.0],
};
