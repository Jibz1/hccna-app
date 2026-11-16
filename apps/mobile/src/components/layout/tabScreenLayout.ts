import type { ViewStyle } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";

import { spacing } from "@/theme/tokens";

export const screenSpacing = {
  headerFallback: 72,
  headerGap: spacing["3xs"],
  tabClearance: 108,
  gutter: spacing["2xs"],
  wideGutter: 22,
} as const;

export function getTabScreenLayout(
  insets: EdgeInsets,
  measuredHeaderHeight: number,
  horizontalPadding: number,
  topOverlayHeight = 0,
) {
  const headerHeight =
    measuredHeaderHeight || insets.top + screenSpacing.headerFallback;
  const topOverlayOffset = headerHeight + screenSpacing.headerGap;
  const contentTop =
    topOverlayHeight > 0
      ? topOverlayOffset + topOverlayHeight + screenSpacing.headerGap
      : topOverlayOffset;

  return {
    headerHeight,
    contentTop,
    topInset: insets.top,
    /** Screen y of a card floating below the header; content starts below it. */
    topOverlayOffset,
    // The negative margin lets content scroll behind the safe-area header.
    // Its matching top padding cancels it at rest; do not add automatic insets.
    style: { marginTop: -insets.top } satisfies ViewStyle,
    contentContainerStyle: {
      paddingTop: insets.top + contentTop,
      paddingBottom: insets.bottom + screenSpacing.tabClearance,
      paddingLeft: insets.left + horizontalPadding,
      paddingRight: insets.right + horizontalPadding,
    } satisfies ViewStyle,
  };
}
