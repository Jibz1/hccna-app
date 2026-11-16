import { addMinutes } from "date-fns";
import { useMutation, graphql } from "react-relay";

import { useAsyncMutation } from "@/hooks/useAsyncMutation";
import { toast } from "@/ui/toast/Toast";
import { DevicePrefs } from "@/utils/devicePrefs";
import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

import {
  useCodeSigninMutation as UseCodeSigninMutationType,
  useCodeSigninMutation$data,
  useCodeSigninMutation$variables,
} from "./__generated__/useCodeSigninMutation.graphql";

const CodeSigninMutation = graphql`
  mutation useCodeSigninMutation($email: String!) {
    createSignInCode(email: $email) {
      message
      success
      countDownTime
    }
  }
`;

export function useCodeSigninMutation() {
  const [commitMutation, isInFlight] =
    useMutation<UseCodeSigninMutationType>(CodeSigninMutation);

  const createSignInCode = (input: useCodeSigninMutation$variables) => {
    return new Promise<useCodeSigninMutation$data>((resolve, reject) => {
      commitMutation({
        variables: {
          email: input.email,
        },
        onCompleted: (response) => {
          if (!response?.createSignInCode?.success) {
            reject(
              new Error(
                response?.createSignInCode?.message ??
                  "Failed to create sign in code",
              ),
            );
            return;
          }
          statsig.logEvent(
            "create_sign_in_code_success",
            "create_sign_in_code",
          );

          resolve(response);
        },
        onError: (error) => {
          captureException(error);
          reject(error);
        },
      });
    });
  };

  return {
    createSignInCode,
    isInFlight,
  };
}

function addTenMinutesToTimestamp(minutes?: number) {
  return addMinutes(Date.now(), minutes ?? 10).getTime();
}
export function useSendSignInCode() {
  const { createSignInCode } = useCodeSigninMutation();
  return useAsyncMutation({
    mutationFn: async (input: useCodeSigninMutation$variables) => {
      if (!input.email) {
        throw new Error("Email is required");
      }
      const response = await createSignInCode(input);
      const countDownTime = response?.createSignInCode?.countDownTime ?? 10;

      DevicePrefs.setSignInWithCodeEmail({
        email: input.email,
        expiresTimestampMs: addTenMinutesToTimestamp(countDownTime),
      });
      return response;
    },

    onError: (error: Error) => {
      DevicePrefs.clearSignInWithCodeEmail();
      toast.error({
        title: "Error sending sign in code",
        message: error.message,
      });
    },
  });
}
