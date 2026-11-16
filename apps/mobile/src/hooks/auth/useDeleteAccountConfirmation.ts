import { getAuth } from "@react-native-firebase/auth";
import { useMutation, graphql } from "react-relay";

import { useAsyncMutation } from "@/hooks/useAsyncMutation";
import { completeAccountDeletion } from "@/utils/completeAccountDeletion";
import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

import {
  useDeleteAccountConfirmationMutation as UseDeleteAccountConfirmationMutationType,
  useDeleteAccountConfirmationMutation$variables,
  useDeleteAccountConfirmationMutation$data,
} from "./__generated__/useDeleteAccountConfirmationMutation.graphql";

const UseDeleteAccountConfirmationMutation = graphql`
  mutation useDeleteAccountConfirmationMutation($code: String!) {
    verifyDeleteAccountCode(code: $code) {
      message
      success
    }
  }
`;

export function useVerifyDeleteAccountCode() {
  const [commitMutation, isInFlight] =
    useMutation<UseDeleteAccountConfirmationMutationType>(
      UseDeleteAccountConfirmationMutation,
    );

  const deleteAccountConfirmation = (
    input: useDeleteAccountConfirmationMutation$variables,
  ) => {
    return new Promise<useDeleteAccountConfirmationMutation$data>(
      (resolve, reject) => {
        commitMutation({
          variables: {
            code: input.code,
          },

          onCompleted: (response) => {
            if (
              !response?.verifyDeleteAccountCode?.success ||
              !response?.verifyDeleteAccountCode?.message
            ) {
              reject(
                new Error(
                  response?.verifyDeleteAccountCode?.message ??
                    "Failed to delete account",
                ),
              );
              return;
            }
            statsig.logEvent(
              "delete_account_confirmation_success",
              "delete_account_confirmation",
            );
            resolve(response);
          },
          onError: (error) => {
            console.error("Error deleting account:", error);
            captureException(error);
            reject(error);
          },
        });
      },
    );
  };
  return {
    deleteAccountConfirmation,
    isInFlight,
  };
}

export function useVerifyDeleteAccountCodeMutation() {
  const { deleteAccountConfirmation } = useVerifyDeleteAccountCode();
  return useAsyncMutation({
    mutationFn: async (
      input: useDeleteAccountConfirmationMutation$variables,
    ) => {
      const uid = getAuth().currentUser?.uid;
      if (!uid) {
        throw new Error("Please sign in before deleting your account.");
      }
      const response = await deleteAccountConfirmation(input);
      if (
        !response?.verifyDeleteAccountCode?.success ||
        !response?.verifyDeleteAccountCode?.message
      ) {
        throw new Error(
          response?.verifyDeleteAccountCode?.message ??
            "Failed to delete account",
        );
      }

      await completeAccountDeletion(uid);
      return response;
    },
  });
}
