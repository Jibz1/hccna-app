import { Platform } from "react-native";

import {
  useAsyncMutation,
  type AsyncMutationCallbacks,
} from "@/hooks/useAsyncMutation";
import { Auth } from "@/utils/auth";
import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

export function useCreateOrSignInGoogleAccountMutation(
  callbacks: AsyncMutationCallbacks<string> = {},
) {
  return useAsyncMutation({
    mutationFn: async () => {
      const uid = await Auth.signInFromProvider("google");
      if (!uid) {
        throw new Error("User not found");
      }

      return uid;
    },
    onError: (error) => {
      statsig.logEvent("sign_in_error", "google", {
        error: error.message,
      });
      captureException(error);
      callbacks.onError?.(error);
    },
    onSuccess: (data) => {
      statsig.logEvent("sign_in_success", "google");
      callbacks.onSuccess?.(data);
    },
    onSettled: callbacks.onSettled,
  });
}

export function useCreateOrSignInAppleAccountMutation() {
  return useAsyncMutation({
    mutationFn: async () => {
      if (Platform.OS !== "ios") {
        throw new Error("Apple Sign-In is only supported on iOS");
      }

      return await Auth.signInFromProvider("apple");
    },
    onError: (error) => {
      statsig.logEvent("sign_in_error", "apple", {
        error: error.message,
      });
      captureException(error);
    },
    onSuccess: () => {
      statsig.logEvent("sign_in_success", "apple");
    },
  });
}
