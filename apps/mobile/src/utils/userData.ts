import { getAuth } from "@react-native-firebase/auth";

import { cancelAndClearPushRegistration } from "@/utils/pushRegistration";
import { captureException } from "@/utils/sentry";
import { clearUserScopedPersistence } from "@/utils/storageRegistry";

export async function clearUserData(previousUid?: string): Promise<void> {
  const currentUid = getAuth().currentUser?.uid;
  // An auth observer may already see the next account (or a guest). Do not
  // retire that identity's push worker while cleaning the previous account.
  const cancellation =
    previousUid && currentUid && previousUid !== currentUid
      ? Promise.resolve()
      : cancelAndClearPushRegistration();
  // Start clearing before yielding, while the old Relay environment is still
  // selected. All user-scoped stores clear synchronously at this boundary.
  const clearing = clearUserScopedPersistence();
  await Promise.all([cancellation.catch(captureException), clearing]);
}
