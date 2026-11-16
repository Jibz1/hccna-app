import { getAuth } from "@react-native-firebase/auth";

import { getRelayAuthScope } from "@/utils/relayPersistence";

export function getPushTokenRegistrationUid(): string | undefined {
  return getAuth().currentUser?.uid;
}

// A guest and an upgraded account can share a Firebase UID, but must never
// share a queued command or a local registration confirmation.
export function getPushTokenRegistrationScope(): string {
  const user = getAuth().currentUser;
  return user?.isAnonymous ? `guest:${user.uid}` : getRelayAuthScope(user?.uid);
}

export function getPushTokenRelayScope(): string {
  const user = getAuth().currentUser;
  return getRelayAuthScope(user?.isAnonymous ? undefined : user?.uid);
}
