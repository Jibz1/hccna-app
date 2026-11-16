import { graphql } from "react-relay";

import {
  useAuthenticatedUid,
  useRefreshQuery,
  useRelayQuerySnapshot,
} from "@/hooks/relay/useUserData";

import type { SavedVersesQuery } from "./__generated__/SavedVersesQuery.graphql";

export const SavedVersesQueryDocument = graphql`
  query SavedVersesQuery {
    user {
      savedVerses {
        verseId
        kind
        savedAt
        book
        text
        image
      }
    }
  }
`;

export type SavedVerseItem =
  SavedVersesQuery["response"]["user"]["savedVerses"][number];

const NO_VERSES: readonly SavedVerseItem[] = [];

/** The signed-in user's saved verses, newest first; empty for guests. */
export function useSavedVerses() {
  const uid = useAuthenticatedUid();
  const result = useRelayQuerySnapshot<SavedVersesQuery>(
    SavedVersesQueryDocument,
  );
  const request = useRefreshQuery<SavedVersesQuery>({
    enabled: uid !== undefined,
    fetchPolicy: "network-only",
    query: SavedVersesQueryDocument,
  });
  const verses = uid ? result?.user?.savedVerses : undefined;
  return {
    isSignedIn: uid !== undefined,
    isLoaded: verses !== undefined,
    failed: verses === undefined && request.status === "error",
    retry: request.retry,
    verses: verses ?? NO_VERSES,
  };
}
