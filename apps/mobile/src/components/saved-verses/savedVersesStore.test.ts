import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  commitLocalUpdate,
} from "relay-runtime";
import { describe, expect, it } from "vitest";

import {
  prependSavedVerse,
  removeSavedVerseFromList,
  writeOptimisticSavedVerse,
} from "@/components/saved-verses/savedVersesStore";
import { getRelayDataID } from "@/relay/getDataID";

const psalm = {
  verseId: "doc-psalm",
  kind: "VERSE_OF_THE_DAY",
  book: "Psalm 23:1",
  text: "The Lord is my shepherd.",
  image: null,
} as const;

function createEnvironment({ loaded = true } = {}) {
  const environment = new Environment({
    getDataID: getRelayDataID,
    network: Network.create(() => Observable.create(() => undefined)),
    store: new Store(new RecordSource()),
  });
  commitLocalUpdate(environment, (store) => {
    const user = store.create("client:root:user", "User");
    store.getRoot().setLinkedRecord(user, "user");
    if (loaded) {
      const john = store.create("SavedVerse:doc-john", "SavedVerse");
      john.setValue("doc-john", "verseId");
      user.setLinkedRecords([john], "savedVerses");
    }
  });
  const savedVerseIds = () => {
    const user = environment.getStore().getSource().get("client:root:user");
    const list = user?.savedVerses as { __refs?: string[] } | undefined;
    return list?.__refs;
  };
  const record = (dataID: string) =>
    environment.getStore().getSource().get(dataID);
  return { environment, record, savedVerseIds };
}

describe("saved verse list updates", () => {
  it("puts a new save first, under the ID the server normalizes it to", () => {
    const { environment, savedVerseIds, record } = createEnvironment();

    commitLocalUpdate(environment, (store) => {
      prependSavedVerse(store, writeOptimisticSavedVerse(store, psalm, "now"));
    });

    expect(savedVerseIds()).toEqual([
      "SavedVerse:doc-psalm",
      "SavedVerse:doc-john",
    ]);
    expect(getRelayDataID({ verseId: "doc-psalm" }, "SavedVerse")).toBe(
      "SavedVerse:doc-psalm",
    );
    expect(record("SavedVerse:doc-psalm")).toMatchObject({
      book: "Psalm 23:1",
      kind: "VERSE_OF_THE_DAY",
      savedAt: "now",
    });
  });

  it("moves a saved verse to the front instead of listing it twice", () => {
    const { environment, savedVerseIds } = createEnvironment();

    commitLocalUpdate(environment, (store) => {
      prependSavedVerse(store, writeOptimisticSavedVerse(store, psalm, "now"));
      const john = store.get("SavedVerse:doc-john");
      if (john) {
        prependSavedVerse(store, john);
      }
    });

    expect(savedVerseIds()).toEqual([
      "SavedVerse:doc-john",
      "SavedVerse:doc-psalm",
    ]);
  });

  it("keeps an existing save's details when it is written optimistically again", () => {
    const { environment, record } = createEnvironment();
    commitLocalUpdate(environment, (store) => {
      writeOptimisticSavedVerse(store, psalm, "first");
    });

    commitLocalUpdate(environment, (store) => {
      writeOptimisticSavedVerse(
        store,
        { ...psalm, kind: "WORD_OF_ACTIVATION" },
        "second",
      );
    });

    expect(record("SavedVerse:doc-psalm")).toMatchObject({
      kind: "VERSE_OF_THE_DAY",
      savedAt: "first",
    });
  });

  it("leaves a list that has not loaded yet for the next fetch", () => {
    const { environment, savedVerseIds } = createEnvironment({ loaded: false });

    commitLocalUpdate(environment, (store) => {
      prependSavedVerse(store, writeOptimisticSavedVerse(store, psalm, "now"));
    });

    expect(savedVerseIds()).toBeUndefined();
  });

  it("removes a save from the list", () => {
    const { environment, savedVerseIds } = createEnvironment();

    commitLocalUpdate(environment, (store) => {
      removeSavedVerseFromList(store, "doc-john");
    });

    expect(savedVerseIds()).toEqual([]);
  });
});
