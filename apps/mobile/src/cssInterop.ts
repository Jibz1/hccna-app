import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {
  type LegendListProps,
  type LegendListRef,
  LegendList,
} from "@legendapp/list/react-native";
import {
  type AnimatedLegendListProps,
  AnimatedLegendList,
} from "@legendapp/list/reanimated";
import { BlurTargetView, BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { type Ref, createElement } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import Svg from "react-native-svg";
import { withUniwind } from "uniwind";

export const StyledSvg = withUniwind(Svg, {
  style: { fromClassName: "className" },
  width: {
    fromClassName: "widthClassName",
    styleProperty: "width",
  },
  height: {
    fromClassName: "heightClassName",
    styleProperty: "height",
  },
  color: {
    fromClassName: "className",
    styleProperty: "color",
  },
  fill: {
    fromClassName: "fillClassName",
    styleProperty: "fill",
  },
});
export const StyledFontAwesome6 = withUniwind(FontAwesome6, {
  style: { fromClassName: "className" },
  color: { fromClassName: "className", styleProperty: "color" },
});
export const StyledImage = withUniwind(Image);
export const StyledLinearGradient = withUniwind(LinearGradient);
export const StyledBlurView = withUniwind(BlurView);
export const StyledBlurTargetView = withUniwind(BlurTargetView);
export const StyledGestureHandlerRootView = withUniwind(GestureHandlerRootView);

export const StyledAnimatedScrollView = withUniwind(Animated.ScrollView, {
  contentContainerStyle: {
    fromClassName: "contentContainerClassName",
  },
});
// Uniwind forwards list props but erases the component's item type parameter.
const UniwindLegendList = withUniwind(LegendList, {
  contentContainerStyle: {
    fromClassName: "contentContainerClassName",
  },
}) as typeof LegendList;

export function StyledLegendList<T>({
  recycleItems = true,
  ref,
  ...props
}: LegendListProps<T> & { ref?: Ref<LegendListRef> }) {
  return createElement(UniwindLegendList<T>, {
    ...props,
    ref,
    recycleItems,
  });
}

// Restore the item type parameter after Uniwind wraps the animated list.
const UniwindAnimatedLegendList = withUniwind(AnimatedLegendList, {
  contentContainerStyle: {
    fromClassName: "contentContainerClassName",
  },
}) as typeof AnimatedLegendList;

export function StyledAnimatedLegendList<T>({
  recycleItems = true,
  ref,
  ...props
}: AnimatedLegendListProps<T> & { ref?: Ref<LegendListRef> }) {
  return createElement(UniwindAnimatedLegendList<T>, {
    ...props,
    ref,
    recycleItems,
  });
}
