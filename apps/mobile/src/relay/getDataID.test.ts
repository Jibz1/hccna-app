import { describe, expect, it } from "vitest";

import { getRelayDataID } from "@/relay/getDataID";

describe("getRelayDataID", () => {
  it("keys saved verses by their scripture catalog ID", () => {
    expect(getRelayDataID({ verseId: "doc-psalm" }, "SavedVerse")).toBe(
      "SavedVerse:doc-psalm",
    );
  });

  it("keeps slug identities scoped to their own types", () => {
    expect(getRelayDataID({ slug: "union" }, "Campus")).toBe("Campus:union");
    expect(getRelayDataID({ verseId: "doc-psalm" }, "Scripture")).toBeNull();
    expect(getRelayDataID({ slug: "union" }, "SavedVerse")).toBeNull();
  });

  it("prefers an explicit id", () => {
    expect(getRelayDataID({ id: 7, verseId: "doc" }, "SavedVerse")).toBe("7");
  });
});
