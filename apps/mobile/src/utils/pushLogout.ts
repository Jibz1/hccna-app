import { getAuth } from "@react-native-firebase/auth";
import { Schema } from "effect";
import { randomUUID } from "expo-crypto";
import { graphql, getRequest } from "relay-runtime";

import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import { connectivity } from "@/effect/connectivity";
import { executeGraphQLRequest } from "@/effect/graphqlNetworkService";
import { pushLogoutStorage } from "@/utils/mmkv";
import { makePushLogoutStore } from "@/utils/pushLogoutStore";
import { pushTokenRegistrationStore } from "@/utils/pushTokenRegistrationStore";

const mutation = graphql`
  mutation PushTokensUnregisterPushTokenMutation(
    $token: String!
    $logoutKey: String!
    $legacyUserId: String
  ) {
    unregisterPushToken(
      token: $token
      logoutKey: $logoutKey
      legacyUserId: $legacyUserId
    )
  }
`;
const decodeResponse = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({ unregisterPushToken: Schema.Literal(true) }),
  }),
);
export const pushLogoutStore = makePushLogoutStore(
  pushLogoutStorage,
  randomUUID,
);
let syncing: Promise<void> | undefined;

export function retirePushRegistration(uid: string): void {
  const confirmed = pushTokenRegistrationStore.get();
  pushLogoutStore.retire(
    uid,
    confirmed?.userId === uid ? confirmed.fcmToken : undefined,
  );
}

export function syncPushLogout(): Promise<void> {
  if (syncing) {
    return syncing;
  }
  if (connectivity.getSnapshot() === "offline") {
    return Promise.resolve();
  }
  const sync = async () => {
    pushLogoutStore.reconcile(getAuth().currentUser?.uid);
    for (const entry of pushLogoutStore.pending()) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 3_000);
      let confirmed = false;
      try {
        await runLiveAppEffect(
          executeGraphQLRequest({
            operation: getRequest(mutation).params,
            variables: {
              token: entry.token,
              logoutKey: entry.logoutKey,
              legacyUserId: entry.legacyUserId ?? null,
            },
            signal: controller.signal,
            sink: {
              next: (response) => {
                decodeResponse(response);
                confirmed = true;
              },
            },
          }),
        );
        if (!confirmed || controller.signal.aborted) {
          throw new Error("Push logout cleanup was not confirmed");
        }
        pushLogoutStore.complete(entry.logoutKey);
      } finally {
        clearTimeout(timeout);
      }
    }
  };
  syncing = sync().finally(() => {
    syncing = undefined;
  });
  return syncing;
}
