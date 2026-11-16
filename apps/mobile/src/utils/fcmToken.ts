import { getMessaging, getToken } from "@react-native-firebase/messaging";
import { Schema } from "effect";

import { connectivity } from "@/effect/connectivity";
import { addBreadcrumb } from "@/utils/sentry";

const TokenFailure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  nativeErrorCode: Schema.optional(
    Schema.NullOr(Schema.Union([Schema.Number, Schema.String])),
  ),
});
const retryDelays = [1_000, 2_000, 4_000];
let pendingToken: Promise<string> | undefined;

function isNetworkFailure(
  error: Schema.Schema.Type<typeof TokenFailure>,
): boolean {
  if (error.code === "messaging/network-request-failed") {
    return true;
  }
  if (error.code !== "messaging/unknown") {
    return false;
  }
  // RN Firebase maps NSError failures to messaging/unknown. Do not retry
  // every unknown error: invalid credentials and configuration also use it.
  return (
    [-1001, -1003, -1004, -1005, -1009, -1200].includes(
      Number(error.nativeErrorCode),
    ) ||
    /network connection was lost|internet connection appears to be offline|request timed out|TLS error caused the secure connection to fail/i.test(
      error.message,
    ) ||
    /\bSERVICE_NOT_AVAILABLE\b/.test(error.message)
  );
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) {
      finish();
    }
  });
}

/** Defer offline/exhausted network attempts until a foreground/connectivity refresh. */
export async function getFcmToken(
  signal: AbortSignal,
): Promise<string | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) {
      return undefined;
    }
    if (connectivity.getSnapshot() === "offline") {
      addBreadcrumb({
        category: "push.registration",
        message: "FCM token acquisition deferred by connectivity status",
        level: "info",
        data: { reason: "offline", attempts: attempt },
      });
      return undefined;
    }
    try {
      // Firebase cannot cancel this request. Share it across effect restarts;
      // each caller still checks its own cancellation before using the token.
      pendingToken ??= getToken(getMessaging()).finally(() => {
        pendingToken = undefined;
      });
      const token = await pendingToken;
      return signal.aborted ? undefined : token;
    } catch (error) {
      if (signal.aborted) {
        return undefined;
      }
      if (!Schema.is(TokenFailure)(error) || !isNetworkFailure(error)) {
        throw error;
      }
      const delay = retryDelays[attempt];
      if (delay === undefined) {
        addBreadcrumb({
          category: "push.registration",
          message: "FCM token acquisition deferred after network retries",
          level: "warning",
          data: {
            reason: "network_retries_exhausted",
            attempts: attempt + 1,
            code: error.code,
            nativeErrorCode: error.nativeErrorCode,
          },
        });
        return undefined;
      }
      await waitForRetry(delay, signal);
    }
  }
}
