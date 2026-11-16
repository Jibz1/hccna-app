import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getTabScreenLayout } from "./tabScreenLayout";

/** Shared geometry for tab ScrollViews and virtualized lists. */
export function useTabScreenLayout(
  horizontalPadding = 0,
  topOverlayHeight = 0,
) {
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(0);

  function onHeaderLayout({ nativeEvent: { layout } }: LayoutChangeEvent) {
    if (layout.height > 0) {
      setHeaderHeight(layout.height);
    }
  }

  return {
    ...getTabScreenLayout(
      insets,
      headerHeight,
      horizontalPadding,
      topOverlayHeight,
    ),
    onHeaderLayout,
  };
}
