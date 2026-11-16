import { getAuth } from "@react-native-firebase/auth";
import { graphql, useMutation } from "react-relay";

import { connectivity } from "@/effect/connectivity";

import type { RemoveSavedVerseMutation } from "./__generated__/RemoveSavedVerseMutation.graphql";
import type { SaveVerseMutation } from "./__generated__/SaveVerseMutation.graphql";
import { savedVerseErrorMessage } from "./savedVerseErrors";
import {
  prependSavedVerse,
  removeSavedVerseFromList,
  writeOptimisticSavedVerse,
  type SavedVerseDraft,
} from "./savedVersesStore";

const saveMutation = graphql`
  mutation SaveVerseMutation($verseId: ID!, $kind: SavedVerseKind!) {
    saveVerse(verseId: $verseId, kind: $kind) {
      verseId
      kind
      savedAt
      book
      text
      image
    }
  }
`;

const removeMutation = graphql`
  mutation RemoveSavedVerseMutation($verseId: ID!) {
    removeSavedVerse(verseId: $verseId) {
      verseId
      removed
    }
  }
`;

/** The signed-in user's uid, or a user-facing reason saving can't happen now. */
function accountForChange(): string {
  const user = getAuth().currentUser;
  if (!user || user.isAnonymous) {
    throw new Error("Sign in to save verses.");
  }
  if (connectivity.getSnapshot() === "offline") {
    throw new Error("Connect to the internet to update your saved verses.");
  }
  return user.uid;
}

export function useSavedVerseActions() {
  const [commitSave, isSaving] = useMutation<SaveVerseMutation>(saveMutation);
  const [commitRemove, isRemoving] =
    useMutation<RemoveSavedVerseMutation>(removeMutation);

  const save = (verse: SavedVerseDraft) =>
    new Promise<void>((resolve, reject) => {
      const uid = accountForChange();
      commitSave({
        variables: { verseId: verse.verseId, kind: verse.kind },
        optimisticUpdater: (store) => {
          const record = writeOptimisticSavedVerse(
            store,
            verse,
            new Date().toISOString(),
          );
          prependSavedVerse(store, record);
        },
        updater: (store) => {
          const record = store.getRootField("saveVerse");
          if (record && getAuth().currentUser?.uid === uid) {
            prependSavedVerse(store, record);
          }
        },
        onCompleted: (response, errors) => {
          if (errors?.length || !response.saveVerse) {
            reject(new Error(savedVerseErrorMessage(new Error(), "save")));
          } else {
            resolve();
          }
        },
        onError: (error) => {
          reject(new Error(savedVerseErrorMessage(error, "save")));
        },
      });
    });

  const remove = (verseId: string) =>
    new Promise<void>((resolve, reject) => {
      const uid = accountForChange();
      commitRemove({
        variables: { verseId },
        optimisticUpdater: (store) => {
          removeSavedVerseFromList(store, verseId);
        },
        // Callers pass IDs from the saved list, which already holds canonical IDs.
        updater: (store) => {
          if (getAuth().currentUser?.uid === uid) {
            removeSavedVerseFromList(store, verseId);
          }
        },
        onCompleted: (response, errors) => {
          if (errors?.length || !response.removeSavedVerse) {
            reject(new Error(savedVerseErrorMessage(new Error(), "remove")));
          } else {
            resolve();
          }
        },
        onError: (error) => {
          reject(new Error(savedVerseErrorMessage(error, "remove")));
        },
      });
    });

  return { save, remove, isPending: isSaving || isRemoving };
}
