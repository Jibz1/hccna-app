import { getAuth } from "@react-native-firebase/auth";

import {
  useAsyncMutation,
  type AsyncMutationCallbacks,
} from "@/hooks/useAsyncMutation";
import { Auth } from "@/utils/auth";
import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

interface LogoutData {
  provider: string | null | undefined;
  uid: string;
}

export function useLogoutMutation({
  onSuccess,
  onError,
  onSettled,
}: AsyncMutationCallbacks<LogoutData> = {}) {
  return useAsyncMutation({
    mutationFn: async (): Promise<LogoutData> => {
      const user = getAuth().currentUser;
      if (!user || user.isAnonymous) {
        throw new Error("User not signed in");
      }
      const uid = user.uid;
      const provider =
        user.providerData.find((info) => info.providerId === "google.com")
          ?.providerId ??
        user.providerData[0]?.providerId ??
        "firebase";
      const type =
        provider === "google.com"
          ? "google"
          : provider === "apple.com"
            ? "apple"
            : "firebase";
      await Auth.signOutFromProvider(type, uid);
      return { provider, uid };
    },
    onError: (error) => {
      statsig.logEvent("sign_out_error", undefined, {
        error: error.message,
      });
      console.error(error);
      captureException(error);
      onError?.(error);
    },
    onSuccess: (data) => {
      statsig.logEvent("sign_out_success", "sign_out", {
        provider: data?.provider ?? "",
      });
      onSuccess?.(data);
    },
    onSettled: (data, error) => {
      onSettled?.(data, error);
    },
  });
}
