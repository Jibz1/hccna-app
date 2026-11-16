import { getAuth } from "@react-native-firebase/auth";
import { useEffect, useRef } from "react";
import { useRelayEnvironment } from "react-relay";

import { useConnectivityStatus } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import {
  fetchUserProfileQuery,
  useAuthenticatedUid,
  useUserProfile,
} from "@/hooks/relay/useUserData";
import { useIsAppActive } from "@/hooks/useIsAppActive";

// About ten minutes plus request time per authenticated Relay session. An
// exhausted job must not poll forever; normal revalidation still applies.
const MAX_ATTEMPTS = 120;
const INTERVAL_MS = 5_000;

/** Mounted once inside the Relay provider, independent of the visible screen. */
export function useProfileEnrichmentRefresh(): void {
  const environment = useRelayEnvironment();
  const profile = useUserProfile();
  const active = useIsAppActive();
  const connectivity = useConnectivityStatus();
  const uid = useAuthenticatedUid();
  const pending = profile?.enrichmentPending;
  const budget = useRef({ environment, uid, attempts: 0, pending: false });

  useEffect(() => {
    if (
      budget.current.environment !== environment ||
      budget.current.uid !== uid
    ) {
      budget.current = { environment, uid, attempts: 0, pending: false };
    }
    const session = budget.current;
    // A temporary null response must not reset the session's polling budget
    // or lose a previously observed pending state.
    if (pending !== undefined) {
      session.pending = pending;
    }
    if (!uid || !session.pending || !active || connectivity !== "online") {
      return;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (!controller.signal.aborted && session.attempts < MAX_ATTEMPTS) {
        timer = setTimeout(() => {
          void refresh();
        }, INTERVAL_MS);
      }
    };
    const refresh = async () => {
      if (getAuth().currentUser?.uid !== uid) {
        return;
      }
      session.attempts += 1;
      try {
        const updated = await fetchUserProfileQuery(
          environment,
          "network-only",
          controller.signal,
        );
        if (updated?.uid === uid && updated.enrichmentPending === false) {
          return;
        }
      } catch {
        // A transient failure leaves the existing profile visible. The next
        // bounded attempt can recover without disrupting signup.
      }
      schedule();
    };
    schedule();

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, connectivity, environment, pending, uid]);
}
