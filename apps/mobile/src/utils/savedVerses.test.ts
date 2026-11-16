import { describe, expect, it } from "vitest";

import {
  collectSavedVerses,
  fromSavedVerseKind,
  guestSavedVerseKeys,
  localSavedVerseImports,
  savedVerseKey,
  type SavedVerse,
} from "@/utils/savedVerses";

const verse: SavedVerse = {
  book: "Psalm 23:1",
  text: "The Lord is my shepherd;\nI shall not want.",
  kind: "verse-of-the-day",
};

describe("saved scripture", () => {
  it("isolates account identities and personal words of activation", () => {
    expect(savedVerseKey("user-a", verse)).not.toBe(
      savedVerseKey("user-b", verse),
    );
    expect(savedVerseKey("anon", verse)).not.toBe(
      savedVerseKey("user-a", verse),
    );
    expect(savedVerseKey("user-a", verse)).not.toBe(
      savedVerseKey("user-a", { ...verse, kind: "word-of-activation" }),
    );
  });

  it("does not conflate translations that share the same reference", () => {
    expect(savedVerseKey("anon", verse)).not.toBe(
      savedVerseKey("anon", {
        ...verse,
        text: "The LORD is my shepherd; I lack nothing.",
      }),
    );
  });

  it("reads legacy saves but excludes other accounts, corrupt values, and mismatched keys", () => {
    const personal = { ...verse, kind: "word-of-activation" as const };
    const records = [
      [savedVerseKey("user-a", verse), JSON.stringify(verse)],
      [savedVerseKey("user-a", personal), JSON.stringify(personal)],
      [savedVerseKey("user-b", personal), JSON.stringify(personal)],
      [savedVerseKey("anon", verse), JSON.stringify(verse)],
      ["scripture:corrupt", "not json"],
      [
        savedVerseKey("user-a", { ...verse, text: "different" }),
        JSON.stringify(verse),
      ],
    ] as const;
    const saved = collectSavedVerses("user-a", records);
    expect(saved).toHaveLength(2);
    expect(saved.map((item) => item.kind).sort()).toEqual([
      "verse-of-the-day",
      "word-of-activation",
    ]);
    expect(collectSavedVerses("anon", records)).toHaveLength(1);
  });
});

describe("device saves moving to the account", () => {
  const personal = { ...verse, kind: "word-of-activation" as const };
  const records = [
    [
      savedVerseKey("user-a", verse),
      JSON.stringify({ ...verse, savedAt: "2026-01-02T03:04:05.000Z" }),
    ],
    [savedVerseKey("user-a", personal), JSON.stringify(personal)],
    [savedVerseKey("user-b", verse), JSON.stringify(verse)],
    [savedVerseKey("anon", verse), JSON.stringify(verse)],
    ["scripture:corrupt", "not json"],
  ] as const;

  it("imports only this account's readable saves, with their kind and date", () => {
    const imports = localSavedVerseImports("user-a", records);

    expect(imports).toEqual([
      {
        key: savedVerseKey("user-a", verse),
        verse: {
          book: verse.book,
          text: verse.text,
          kind: "VERSE_OF_THE_DAY",
          savedAt: "2026-01-02T03:04:05.000Z",
        },
      },
      {
        key: savedVerseKey("user-a", personal),
        verse: {
          book: verse.book,
          text: verse.text,
          kind: "WORD_OF_ACTIVATION",
          savedAt: null,
        },
      },
    ]);
  });

  it("finds guest saves, which are no longer kept", () => {
    const keys = records.map(([key]) => key);

    expect(guestSavedVerseKeys(keys)).toEqual([savedVerseKey("anon", verse)]);
  });

  it("maps account kinds back to the app's kinds", () => {
    expect(fromSavedVerseKind("WORD_OF_ACTIVATION")).toBe("word-of-activation");
    expect(fromSavedVerseKind("VERSE_OF_THE_DAY")).toBe("verse-of-the-day");
  });
});
