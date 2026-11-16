import type { RecordProxy, RecordSourceSelectorProxy } from "relay-runtime";

import { getRelayDataID } from "@/relay/getDataID";

export interface SavedVerseDraft {
  readonly verseId: string;
  readonly kind: "VERSE_OF_THE_DAY" | "WORD_OF_ACTIVATION";
  readonly book: string;
  readonly text: string;
  readonly image: string | null;
}

function savedVerseList(store: RecordSourceSelectorProxy) {
  const user = store.getRoot().getLinkedRecord("user");
  const verses = user?.getLinkedRecords("savedVerses");
  // An unloaded list stays unloaded; its next fetch already includes the change.
  return user && verses ? { user, verses } : undefined;
}

/** The record a save will normalize to, created with the details shown until the server replies. */
export function writeOptimisticSavedVerse(
  store: RecordSourceSelectorProxy,
  verse: SavedVerseDraft,
  savedAt: string,
): RecordProxy {
  const dataID =
    getRelayDataID({ verseId: verse.verseId }, "SavedVerse") ??
    `SavedVerse:${verse.verseId}`;
  const existing = store.get(dataID);
  if (existing) {
    return existing;
  }
  const record = store.create(dataID, "SavedVerse");
  record.setValue(verse.verseId, "verseId");
  record.setValue(verse.kind, "kind");
  record.setValue(savedAt, "savedAt");
  record.setValue(verse.book, "book");
  record.setValue(verse.text, "text");
  record.setValue(verse.image, "image");
  return record;
}

/** Shows a save first in the user's list, without listing it twice. */
export function prependSavedVerse(
  store: RecordSourceSelectorProxy,
  record: RecordProxy,
): void {
  const list = savedVerseList(store);
  if (!list) {
    return;
  }
  const verseId = record.getValue("verseId");
  const others = list.verses.filter(
    (verse) => verse?.getValue("verseId") !== verseId,
  );
  list.user.setLinkedRecords([record, ...others], "savedVerses");
}

export function removeSavedVerseFromList(
  store: RecordSourceSelectorProxy,
  verseId: string,
): void {
  const list = savedVerseList(store);
  if (!list) {
    return;
  }
  const remaining = list.verses.filter(
    (verse) => verse?.getValue("verseId") !== verseId,
  );
  list.user.setLinkedRecords(remaining, "savedVerses");
}
