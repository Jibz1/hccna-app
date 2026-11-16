import { getAuth, signInWithCustomToken } from "@react-native-firebase/auth";
import { useMutation, graphql } from "react-relay";

import { useAsyncMutation } from "@/hooks/useAsyncMutation";
import { waitForUserDocument } from "@/utils/auth";
import { completeSignIn } from "@/utils/completeSignIn";
import { DevicePrefs } from "@/utils/devicePrefs";
import { ensureUserProfile } from "@/utils/ensureUserProfile";
import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

import {
  useCodeVerificationMutation as UseCodeVerificationMutationTypeMutation,
  useCodeVerificationMutation$data,
  useCodeVerificationMutation$variables,
} from "./__generated__/useCodeVerificationMutation.graphql";

const CodeVerificationMutation = graphql`
  mutation useCodeVerificationMutation($email: String!, $code: String!) {
    verifySignInCode(email: $email, code: $code) {
      message
      success
      token
    }
  }
`;

export function useCodeVerificationMutation() {
  const [commitMutation, isInFlight] =
    useMutation<UseCodeVerificationMutationTypeMutation>(
      CodeVerificationMutation,
    );

  const verifySignInCode = (input: useCodeVerificationMutation$variables) => {
    return new Promise<useCodeVerificationMutation$data>((resolve, reject) => {
      commitMutation({
        variables: {
          email: input.email,
          code: input.code,
        },
        onCompleted: (response) => {
          if (
            !response?.verifySignInCode?.success ||
            !response?.verifySignInCode?.token
          ) {
            reject(
              new Error(
                response?.verifySignInCode?.message ??
                  "Failed to verify sign in code",
              ),
            );
            return;
          }

          statsig.logEvent(
            "verify_sign_in_code_success",
            "verify_sign_in_code",
          );
          DevicePrefs.clearSignInWithCodeEmail();

          resolve(response);
        },
        onError: (error) => {
          console.error("Error verifying sign in code:", error);
          captureException(error);
          reject(error);
        },
      });
    });
  };

  return {
    verifySignInCode,
    isInFlight,
  };
}

export function useVerifySignInWithCode() {
  const { verifySignInCode } = useCodeVerificationMutation();
  return useAsyncMutation({
    mutationFn: async (input: useCodeVerificationMutation$variables) => {
      const response = await verifySignInCode(input);
      if (!response?.verifySignInCode?.token) {
        throw new Error("No token");
      }
      const userCredential = await signInWithCustomToken(
        getAuth(),
        response.verifySignInCode.token,
      );
      try {
        await ensureUserProfile();
      } catch (error) {
        captureException(error);
        statsig.logEvent("ensure_user_profile_fallback", "sign_in_code");
        await waitForUserDocument(userCredential.user.uid);
      }
      await completeSignIn(userCredential.user.uid);
      return userCredential;
    },
  });
}
