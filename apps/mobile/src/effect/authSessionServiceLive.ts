import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "@react-native-firebase/auth";
import { Effect, Layer } from "effect";

import {
  AccountDeletionCleanupError,
  AccountDeletionSignOutError,
} from "@/effect/errors";
import type { FirebaseUid } from "@/effect/schema";

import {
  AuthSessionService,
  makeAuthSessionService,
  profileNotReady,
} from "./authSessionService";

const cleanupError = (uid: FirebaseUid, operation: string, cause: unknown) =>
  new AccountDeletionCleanupError({
    uid,
    operation,
    cause,
    message:
      "Your account was deleted, but clearing local data failed. Please restart the app.",
  });

export const AuthSessionServiceLive = Layer.succeed(
  AuthSessionService,
  makeAuthSessionService({
    getCurrentUid: () => getAuth().currentUser?.uid ?? null,
    subscribeAuthChanges: (onChange) =>
      onAuthStateChanged(getAuth(), (user) => {
        onChange(user?.uid ?? null);
      }),
    captureRelaySession: (uid) => {
      // Relay and storage use the app runtime; resolve them at execution time.
      const { getEnvironmentState } =
        require("@/utils/getDefaultRelayStore") as typeof import("@/utils/getDefaultRelayStore");
      const { getRelayAuthScope } =
        require("@/utils/relayPersistence") as typeof import("@/utils/relayPersistence");
      const state = getEnvironmentState();
      if (state?.authScope !== getRelayAuthScope(uid)) {
        return null;
      }

      return {
        isCurrent: () => getEnvironmentState() === state,
        readProfile: Effect.tryPromise({
          try: (signal) => {
            const { fetchUserProfileQuery } =
              require("@/hooks/relay/useUserData") as typeof import("@/hooks/relay/useUserData");
            return fetchUserProfileQuery(
              state.environment,
              "network-only",
              signal,
            );
          },
          catch: (cause) => profileNotReady(uid, cause),
        }).pipe(
          Effect.map((profile) => (profile?.uid ? { uid: profile.uid } : null)),
        ),
        clear: Effect.try({
          try: () => {
            state.dispose();
            state.source.clear();
            state.store.notify();
          },
          catch: (cause) => cleanupError(uid, "relay", cause),
        }),
      };
    },
    signOut: (uid) =>
      Effect.tryPromise({
        try: () => signOut(getAuth()),
        catch: (cause) =>
          new AccountDeletionSignOutError({
            uid,
            cause,
            message:
              "Your account was deleted, but signing out failed. Please restart the app.",
          }),
      }),
    clearUserData: (uid) =>
      Effect.tryPromise({
        try: () => {
          const { clearUserData } =
            require("@/utils/userData") as typeof import("@/utils/userData");
          return clearUserData();
        },
        catch: (cause) => cleanupError(uid, "persistence", cause),
      }),
    clearSignInEmail: (uid) =>
      Effect.try({
        try: () => {
          const { DevicePrefs } =
            require("@/utils/devicePrefs") as typeof import("@/utils/devicePrefs");
          DevicePrefs.clearSignInWithCodeEmail();
        },
        catch: (cause) => cleanupError(uid, "signInEmail", cause),
      }),
  }),
);
