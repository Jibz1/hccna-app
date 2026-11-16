import { getAuth } from "@react-native-firebase/auth";
import { useEffect, useRef } from "react";
import {
  commitMutation,
  fetchQuery,
  graphql,
  useRelayEnvironment,
} from "react-relay";
import type { Environment } from "relay-runtime";

import { useConnectivityStatus } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { useAuthenticatedUid } from "@/hooks/relay/useUserData";
import { savedVersesStorage } from "@/utils/mmkv";
import {
  guestSavedVerseKeys,
  localSavedVerseImports,
} from "@/utils/savedVerses";

import type { ImportSavedVersesMutation } from "./__generated__/ImportSavedVersesMutation.graphql";
import type { SavedVersesQuery } from "./__generated__/SavedVersesQuery.graphql";
import { SavedVersesQueryDocument } from "./useSavedVerses";

const importMutation = graphql`
  mutation ImportSavedVersesMutation($verses: [SavedVerseImportInput!]!) {
    importSavedVerses(verses: $verses) {
      imported
      alreadySaved
      skipped
    }
  }
`;

function readDeviceSaves() {
  return savedVersesStorage
    .getAllKeys()
    .map((key) => [key, savedVersesStorage.getString(key)] as const);
}

/**
 * Mounted once inside the Relay provider. Moves the signed-in user's device saves to their
 * account, clearing each one only after the server confirms it, so an interrupted import is
 * retried on a later launch without duplicates.
 */
export function useSavedVersesImport(): void {
  const environment = useRelayEnvironment();
  const uid = useAuthenticatedUid();
  const connectivity = useConnectivityStatus();
  const started = useRef<{ environment: Environment; uid: string }>(undefined);

  useEffect(() => {
    // Saving now requires an account, so saves made while signed out are not kept.
    for (const key of guestSavedVerseKeys(savedVersesStorage.getAllKeys())) {
      savedVersesStorage.remove(key);
    }
  }, []);

  useEffect(() => {
    if (!uid || connectivity !== "online") {
      return;
    }
    const session = started.current;
    if (session?.environment === environment && session.uid === uid) {
      return;
    }
    const pending = localSavedVerseImports(uid, readDeviceSaves());
    if (pending.length === 0) {
      return;
    }
    started.current = { environment, uid };
    commitMutation<ImportSavedVersesMutation>(environment, {
      mutation: importMutation,
      variables: { verses: pending.map((entry) => entry.verse) },
      onCompleted: (response, errors) => {
        if (
          errors?.length ||
          !response.importSavedVerses ||
          getAuth().currentUser?.uid !== uid
        ) {
          started.current = undefined;
          return;
        }
        for (const entry of pending) {
          savedVersesStorage.remove(entry.key);
        }
        void fetchQuery<SavedVersesQuery>(
          environment,
          SavedVersesQueryDocument,
          {},
          { fetchPolicy: "network-only" },
        )
          .toPromise()
          .catch(() => undefined);
      },
      onError: () => {
        started.current = undefined;
      },
    });
  }, [connectivity, environment, uid]);
}
