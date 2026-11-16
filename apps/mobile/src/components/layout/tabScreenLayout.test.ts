import { describe, expect, it } from "vitest";

import { getTabScreenLayout } from "./tabScreenLayout";

describe("tab screen geometry", () => {
  it.each([
    { top: 0, bottom: 0, left: 0, right: 0 },
    { top: 59, bottom: 34, left: 0, right: 0 },
    { top: 0, bottom: 21, left: 59, right: 59 },
  ])("places content below the measured header with insets %o", (insets) => {
    const layout = getTabScreenLayout(insets, 124, 20);

    // Account for the ScrollView's negative margin when checking screen position.
    expect(
      layout.style.marginTop + layout.contentContainerStyle.paddingTop,
    ).toBe(140);
    expect(layout.contentTop).toBe(140);
    expect(layout.contentContainerStyle.paddingLeft).toBe(insets.left + 20);
    expect(layout.contentContainerStyle.paddingRight).toBe(insets.right + 20);
    expect(layout.contentContainerStyle.paddingBottom).toBe(
      insets.bottom + 108,
    );
  });

  it("floats a top overlay below the header and moves content beneath it", () => {
    const insets = { top: 59, bottom: 34, left: 0, right: 0 };
    const hidden = getTabScreenLayout(insets, 124, 0);
    const shown = getTabScreenLayout(insets, 124, 0, 64);

    expect(hidden.topOverlayOffset).toBe(140);
    expect(hidden.contentTop).toBe(140);
    expect(shown.topOverlayOffset).toBe(140);
    // Content keeps the header's gap below the overlay.
    expect(shown.contentTop).toBe(140 + 64 + 16);
    expect(shown.style.marginTop + shown.contentContainerStyle.paddingTop).toBe(
      shown.contentTop,
    );
    expect(shown.contentContainerStyle.paddingBottom).toBe(34 + 108);
  });

  it("uses a safe-area-aware header estimate until layout is measured", () => {
    const insets = { top: 59, bottom: 34, left: 0, right: 0 };
    const estimated = getTabScreenLayout(insets, 0, 0);
    const measured = getTabScreenLayout(insets, 100, 0);

    expect(estimated.headerHeight).toBe(131);
    expect(estimated.contentTop).toBe(147);
    expect(measured.headerHeight).toBe(100);
    expect(measured.contentTop).toBe(116);
    expect(measured.contentContainerStyle.paddingLeft).toBe(0);
  });
});
