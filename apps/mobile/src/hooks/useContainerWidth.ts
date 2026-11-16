import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";

// A sheet or sidebar can be narrower than the app window. Size its children
// from layout, and retain the last visible width while a tab is detached.
export function useContainerWidth(initialWidth = 0) {
  const [width, setWidth] = useState(initialWidth);
  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (Number.isFinite(layout.width) && layout.width > 0) {
      setWidth(layout.width);
    }
  };
  return { width, onLayout };
}
