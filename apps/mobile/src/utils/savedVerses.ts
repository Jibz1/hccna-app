import { Option, Schema } from "effect";

const SavedVerseSchema = Schema.Struct({
  book: Schema.String,
  text: Schema.String,
  kind: Schema.Literals(["verse-of-the-day", "word-of-activation"]),
  image: Schema.optional(Schema.String),
});
export type SavedVerse = typeof SavedVerseSchema.Type;
const SavedVerseRecordSchema = Schema.Struct({
  ...SavedVerseSchema.fields,
  id: Schema.optionalKey(Schema.String),
  savedAt: Schema.optionalKey(Schema.String),
});
export type SavedVerseRecord = typeof SavedVerseRecordSchema.Type;
export type SavedVerseEntry = SavedVerseRecord & { readonly key: string };
const decodeSavedVerse = Schema.decodeUnknownOption(
  Schema.fromJsonString(SavedVerseRecordSchema),
);

/** Exact identities keep different translations and personal content separate. */
export function savedVerseKey(authScope: string, verse: SavedVerse): string {
  return `scripture:${JSON.stringify([authScope, verse.kind, verse.book, verse.text])}`;
}

function parseSavedVerse(
  serialized: string | undefined,
): SavedVerseRecord | null {
  if (!serialized) {
    return null;
  }
  return Option.getOrNull(decodeSavedVerse(serialized));
}

export function collectSavedVerses(
  authScope: string,
  records: readonly (readonly [string, string | undefined])[],
): SavedVerseEntry[] {
  const verses: SavedVerseEntry[] = [];
  for (const [key, serialized] of records) {
    const verse = parseSavedVerse(serialized);
    if (verse && key === savedVerseKey(authScope, verse)) {
      verses.push({ ...verse, key });
    }
  }
  return verses.sort((a, b) => {
    const dateA = Date.parse(a.savedAt ?? "") || 0;
    const dateB = Date.parse(b.savedAt ?? "") || 0;
    return dateB - dateA || a.key.localeCompare(b.key);
  });
}

type SavedVerseKindInput = "VERSE_OF_THE_DAY" | "WORD_OF_ACTIVATION";

/** One device save, ready for `importSavedVerses`, with the key to clear once it is imported. */
export interface LocalSavedVerseImport {
  readonly key: string;
  readonly verse: {
    readonly book: string;
    readonly text: string;
    readonly kind: SavedVerseKindInput;
    readonly savedAt: string | null;
  };
}

const kindInputs: Record<SavedVerse["kind"], SavedVerseKindInput> = {
  "verse-of-the-day": "VERSE_OF_THE_DAY",
  "word-of-activation": "WORD_OF_ACTIVATION",
};

export function toSavedVerseKindInput(
  kind: SavedVerse["kind"],
): SavedVerseKindInput {
  return kindInputs[kind];
}

export function fromSavedVerseKind(kind: string): SavedVerse["kind"] {
  return kind === "WORD_OF_ACTIVATION"
    ? "word-of-activation"
    : "verse-of-the-day";
}

/** Saves this account made on this device before saves moved to the account. */
export function localSavedVerseImports(
  uid: string,
  records: readonly (readonly [string, string | undefined])[],
): LocalSavedVerseImport[] {
  return collectSavedVerses(uid, records).map((entry) => ({
    key: entry.key,
    verse: {
      book: entry.book,
      text: entry.text,
      kind: toSavedVerseKindInput(entry.kind),
      savedAt: entry.savedAt ?? null,
    },
  }));
}

/** Saves made while signed out; saving now requires an account, so these are cleared. */
export function guestSavedVerseKeys(keys: readonly string[]): string[] {
  const prefix = `scripture:[${JSON.stringify("anon")},`;
  return keys.filter((key) => key.startsWith(prefix));
}
