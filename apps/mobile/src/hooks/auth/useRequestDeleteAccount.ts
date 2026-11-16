import { useMutation, graphql } from "react-relay";

import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

import {
  useRequestDeleteAccountMutation as UseRequestDeleteAccountMutationType,
  useRequestDeleteAccountMutation$data,
  useRequestDeleteAccountMutation$variables,
} from "./__generated__/useRequestDeleteAccountMutation.graphql";

const UseRequestDeleteAccountMutation = graphql`
  mutation useRequestDeleteAccountMutation {
    requestDeleteAccount {
      message
      success
    }
  }
`;

export function useRequestDeleteAccount() {
  const [commitMutation, isInFlight] =
    useMutation<UseRequestDeleteAccountMutationType>(
      UseRequestDeleteAccountMutation,
    );

  const requestDeleteAccount = (
    input: useRequestDeleteAccountMutation$variables,
  ) => {
    return new Promise<useRequestDeleteAccountMutation$data>(
      (resolve, reject) => {
        commitMutation({
          variables: {},
          onCompleted: (response) => {
            if (!response?.requestDeleteAccount?.success) {
              reject(
                new Error(
                  response?.requestDeleteAccount?.message ??
                    "Failed to create sign in code",
                ),
              );
              return;
            }
            statsig.logEvent(
              "request_delete_account_success",
              "request_delete_account",
              {
                email: input.email,
              },
            );

            resolve(response);
          },
          onError: (error) => {
            console.error("Error creating attendance:", error);
            captureException(error);
            reject(error);
          },
        });
      },
    );
  };

  return {
    requestDeleteAccount,
    isInFlight,
  };
}
