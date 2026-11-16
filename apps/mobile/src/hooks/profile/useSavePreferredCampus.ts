import { getAuth } from "@react-native-firebase/auth";
import { useState } from "react";
import { graphql, useMutation } from "react-relay";

import { connectivity } from "@/effect/connectivity";

import type { SetPreferredCampusMutation } from "./__generated__/SetPreferredCampusMutation.graphql";

const mutation = graphql`
  mutation SetPreferredCampusMutation(
    $campusSlug: String!
    $expectedVersion: Int!
  ) {
    setPreferredCampus(
      campusSlug: $campusSlug
      expectedVersion: $expectedVersion
    ) {
      success
      preferredCampusSlug
      campusPreferenceVersion
      syncPending
    }
  }
`;

export function useSavePreferredCampus() {
  const [commit, isSaving] = useMutation<SetPreferredCampusMutation>(mutation);
  const [error, setError] = useState<Error | null>(null);
  const save = async (campusSlug: string, expectedVersion: number) => {
    setError(null);
    try {
      const user = getAuth().currentUser;
      if (!user || user.isAnonymous) {
        throw new Error("Sign in to choose a campus.");
      }
      if (connectivity.getSnapshot() === "offline") {
        throw new Error("Connect to the internet to save your campus.");
      }
      const uid = user.uid;
      await new Promise<void>((resolve, reject) => {
        commit({
          variables: { campusSlug, expectedVersion },
          updater: (store) => {
            if (getAuth().currentUser?.uid !== uid) {
              return;
            }
            const result = store.getRootField("setPreferredCampus");
            const profile = store
              .getRoot()
              .getLinkedRecord("user")
              ?.getLinkedRecord("profile");
            if (!result || profile?.getValue("uid") !== uid) {
              return;
            }
            const version = result.getValue("campusPreferenceVersion");
            const currentVersion = profile.getValue("campusPreferenceVersion");
            if (Number(version) < Number(currentVersion ?? 0)) {
              return;
            }
            profile.setValue(
              result.getValue("preferredCampusSlug"),
              "preferredCampusSlug",
            );
            profile.setValue(version, "campusPreferenceVersion");
          },
          onCompleted: (response, errors) => {
            if (getAuth().currentUser?.uid !== uid) {
              reject(new Error("Your account changed. Please try again."));
            } else if (errors?.length || !response.setPreferredCampus) {
              reject(new Error("Couldn't save your campus. Please try again."));
            } else if (!response.setPreferredCampus.success) {
              reject(
                new Error(
                  "Your campus changed on another device. Review the current choice and try again.",
                ),
              );
            } else {
              resolve();
            }
          },
          onError: () => {
            reject(
              new Error(
                "Couldn't save your campus. Check your connection and try again.",
              ),
            );
          },
        });
      });
    } catch (cause) {
      const nextError =
        cause instanceof Error
          ? cause
          : new Error("Couldn't save your campus. Please try again.");
      setError(nextError);
      throw nextError;
    }
  };
  return { save, isSaving, error };
}
