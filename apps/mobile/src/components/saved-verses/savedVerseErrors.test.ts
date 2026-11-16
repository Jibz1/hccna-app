import { describe, expect, it } from "vitest";

import { savedVerseErrorMessage } from "@/components/saved-verses/savedVerseErrors";

// Relay rejects a mutation whose non-null field failed with the GraphQL errors on `source`.
function relayError(extensions: { code?: string; reason?: string }) {
  return Object.assign(new Error("No data returned for operation"), {
    source: { errors: [{ message: "failed", extensions }] },
  });
}

describe("savedVerseErrorMessage", () => {
  it("explains the saved verse limit", () => {
    const error = relayError({
      code: "BAD_USER_INPUT",
      reason: "SAVED_VERSE_LIMIT",
    });

    expect(savedVerseErrorMessage(error, "save")).toMatch(
      /most verses you can save/,
    );
  });

  it("explains a verse the account cannot keep", () => {
    const error = relayError({
      code: "BAD_USER_INPUT",
      reason: "SCRIPTURE_NOT_FOUND",
    });

    expect(savedVerseErrorMessage(error, "save")).toMatch(/can't be saved/);
  });

  it("asks to retry while the profile is being set up", () => {
    const error = relayError({ code: "PROFILE_UNAVAILABLE" });

    expect(savedVerseErrorMessage(error, "save")).toMatch(/still being set up/);
  });

  it("falls back to a connection message for other failures", () => {
    expect(
      savedVerseErrorMessage(new Error("Network request failed"), "remove"),
    ).toBe("Couldn't remove this verse. Check your connection and try again.");
  });
});
