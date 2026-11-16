import { getAuth, onAuthStateChanged } from "@react-native-firebase/auth";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";

import { environmentAtom } from "@/environment";
import { ensureUserProfileQuery } from "@/hooks/relay/useUserData";
import { retirePushRegistration } from "@/utils/pushLogout";
import {
  ANONYMOUS_RELAY_AUTH_SCOPE,
  getRelayAuthScope,
} from "@/utils/relayPersistence";
import { captureException } from "@/utils/sentry";
import { clearUserData } from "@/utils/userData";

export function useIsLoggedIn() {
  // Following Firebase docs pattern: use initializing to track first callback
  const [initializing, setInitializing] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  const [authScope, setAuthScope] = useState(ANONYMOUS_RELAY_AUTH_SCOPE);
  // Track if we've ever seen an authenticated user in this session
  const hasSeenUser = useRef(false);
  const lastRefreshedAuthScope = useRef<string | null>(null);
  const previousUid = useRef<string | null>(null);
  const refreshAttempt = useRef(0);
  const refreshingAuthScope = useRef<string | null>(null);
  const relayEnvironmentState = useAtomValue(environmentAtom);
  const relayEnvironmentAuthScope = relayEnvironmentState?.authScope ?? null;

  useEffect(() => {
    const subscriber = onAuthStateChanged(getAuth(), (firebaseUser) => {
      const nextUid = firebaseUser?.isAnonymous
        ? null
        : (firebaseUser?.uid ?? null);

      if (nextUid) {
        // User is authenticated - refresh profile data
        hasSeenUser.current = true;
        if (previousUid.current && previousUid.current !== nextUid) {
          try {
            retirePushRegistration(previousUid.current);
          } catch (error) {
            captureException(error);
          }
          void clearUserData(previousUid.current ?? undefined).catch(
            captureException,
          );
        }
        previousUid.current = nextUid;
      } else if (hasSeenUser.current || previousUid.current) {
        // We had a user before but now we don't
        // This means: backend logout, token revoked, or session expired
        // Clear the cached data
        if (previousUid.current) {
          try {
            retirePushRegistration(previousUid.current);
          } catch (error) {
            captureException(error);
          }
        }
        void clearUserData(previousUid.current ?? undefined).catch(
          captureException,
        );
        hasSeenUser.current = false;
        previousUid.current = null;
      }
      // If !firebaseUser && !hasSeenUser: initial app launch with no auth
      // Don't clear - there's nothing to clear anyway

      setAuthScope(getRelayAuthScope(nextUid));
      setUid(nextUid);
      setInitializing(false);
    });

    return subscriber;
  }, []);

  useEffect(() => {
    if (
      initializing ||
      uid === null ||
      relayEnvironmentState === null ||
      relayEnvironmentAuthScope !== authScope ||
      lastRefreshedAuthScope.current === authScope ||
      refreshingAuthScope.current === authScope
    ) {
      if (!initializing && uid === null) {
        refreshAttempt.current += 1;
        refreshingAuthScope.current = null;
        lastRefreshedAuthScope.current = null;
      }
      return;
    }

    const attempt = refreshAttempt.current + 1;
    refreshAttempt.current = attempt;
    refreshingAuthScope.current = authScope;

    void ensureUserProfileQuery(relayEnvironmentState.environment)
      .then((profile) => {
        if (refreshAttempt.current !== attempt) {
          return;
        }

        refreshingAuthScope.current = null;
        const currentUid = getAuth().currentUser?.uid ?? null;
        if (
          profile?.uid === uid &&
          currentUid === uid &&
          getRelayAuthScope(currentUid) === authScope &&
          relayEnvironmentState.authScope === authScope
        ) {
          lastRefreshedAuthScope.current = authScope;
        }
      })
      .catch(() => {
        if (refreshAttempt.current === attempt) {
          refreshingAuthScope.current = null;
        }
      });

    return () => {
      if (refreshAttempt.current === attempt) {
        refreshAttempt.current += 1;
        refreshingAuthScope.current = null;
      }
    };
  }, [
    authScope,
    initializing,
    relayEnvironmentAuthScope,
    relayEnvironmentState,
    uid,
  ]);

  return {
    isLoggedIn: !initializing && uid !== null,
    isAuthReady: !initializing,
    authScope,
  };
}
