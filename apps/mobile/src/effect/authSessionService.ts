import { Context, Effect, Result, Schedule } from "effect";

import {
  AccountDeletionCleanupError,
  AccountDeletionSignOutError,
  AuthProfileNotReadyError,
  AuthSessionChangedError,
} from "@/effect/errors";
import type { FirebaseUid } from "@/effect/schema";

export type AuthSessionRelay = {
  readonly isCurrent: () => boolean;
  readonly readProfile: Effect.Effect<
    { readonly uid: string } | null,
    AuthProfileNotReadyError
  >;
  readonly clear: Effect.Effect<void, AccountDeletionCleanupError>;
};

export type AuthSessionServiceDependencies = {
  readonly getCurrentUid: () => string | null;
  readonly subscribeAuthChanges: (
    onChange: (uid: string | null) => void,
  ) => () => void;
  readonly captureRelaySession: (uid: FirebaseUid) => AuthSessionRelay | null;
  readonly signOut: (
    uid: FirebaseUid,
  ) => Effect.Effect<void, AccountDeletionSignOutError>;
  readonly clearUserData: (
    uid: FirebaseUid,
  ) => Effect.Effect<void, AccountDeletionCleanupError>;
  readonly clearSignInEmail: (
    uid: FirebaseUid,
  ) => Effect.Effect<void, AccountDeletionCleanupError>;
};

export type AuthSessionServiceApi = {
  readonly completeSignIn: (
    uid: FirebaseUid,
  ) => Effect.Effect<void, AuthSessionChangedError | AuthProfileNotReadyError>;
  /** Clear the local session only after the backend confirms deletion. */
  readonly completeAccountDeletion: (
    uid: FirebaseUid,
  ) => Effect.Effect<
    void,
    | AuthSessionChangedError
    | AccountDeletionSignOutError
    | AccountDeletionCleanupError
  >;
};

export class AuthSessionService extends Context.Service<
  AuthSessionService,
  AuthSessionServiceApi
>()("AuthSessionService") {}

export const profileNotReady = (uid: FirebaseUid, cause?: unknown) =>
  new AuthProfileNotReadyError({
    uid,
    message: "We couldn't load your profile. Please try signing in again.",
    cause,
  });

const signInSessionChanged = (uid: FirebaseUid) =>
  new AuthSessionChangedError({
    uid,
    message: "Your sign-in session changed. Please sign in again.",
  });

export function makeAuthSessionService(
  dependencies: AuthSessionServiceDependencies,
): AuthSessionServiceApi {
  const requireSignInSession = Effect.fn(
    "AuthSessionService.requireSignInSession",
  )(function* (uid: FirebaseUid) {
    if (dependencies.getCurrentUid() !== uid) {
      return yield* signInSessionChanged(uid);
    }
  });

  const awaitSessionChange = Effect.fn("AuthSessionService.awaitSessionChange")(
    function* (uid: FirebaseUid) {
      let unsubscribe: (() => void) | undefined;
      return yield* Effect.callback<never, AuthSessionChangedError>(
        (resume) => {
          unsubscribe = dependencies.subscribeAuthChanges((currentUid) => {
            if (currentUid !== uid) {
              resume(Effect.fail(signInSessionChanged(uid)));
            }
          });
        },
      ).pipe(Effect.ensuring(Effect.sync(() => unsubscribe?.())));
    },
  );

  const readMatchingProfile = Effect.fn(
    "AuthSessionService.readMatchingProfile",
  )(function* (uid: FirebaseUid) {
    yield* requireSignInSession(uid);
    const relay = dependencies.captureRelaySession(uid);
    if (!relay) {
      return yield* profileNotReady(uid);
    }

    const profile = yield* relay.readProfile;
    yield* requireSignInSession(uid);
    if (profile?.uid !== uid || !relay.isCurrent()) {
      return yield* profileNotReady(uid);
    }
  });

  const completeSignIn = Effect.fn("AuthSessionService.completeSignIn")(
    function* (uid: FirebaseUid) {
      yield* readMatchingProfile(uid).pipe(
        Effect.retry({
          schedule: Schedule.exponential(250),
          times: 5,
          while: (error) => error._tag === "AuthProfileNotReadyError",
        }),
        Effect.raceFirst(awaitSessionChange(uid)),
      );
    },
  );

  const clearDeletedUserData = Effect.fn(
    "AuthSessionService.clearDeletedUserData",
  )(function* (uid: FirebaseUid, relay: AuthSessionRelay | null) {
    // Attempt every cleanup even if an earlier storage operation fails.
    const results = yield* Effect.forEach(
      [
        { operation: "relay", effect: relay?.clear ?? Effect.void },
        { operation: "persistence", effect: dependencies.clearUserData(uid) },
        {
          operation: "signInEmail",
          effect: dependencies.clearSignInEmail(uid),
        },
      ],
      ({ operation, effect }) =>
        effect.pipe(
          // The finalizer stays protected while its timed child can be stopped.
          Effect.interruptible,
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () =>
              Effect.fail(
                new AccountDeletionCleanupError({
                  uid,
                  operation,
                  message:
                    "Your account was deleted, but clearing local data timed out. Please restart the app.",
                }),
              ),
          }),
          Effect.result,
        ),
    );
    for (const result of results) {
      if (Result.isFailure(result)) {
        return yield* result.failure;
      }
    }
  });

  const completeAccountDeletion = Effect.fn(
    "AuthSessionService.completeAccountDeletion",
  )(function* (uid: FirebaseUid) {
    const currentUid = dependencies.getCurrentUid();
    if (currentUid && currentUid !== uid) {
      return yield* new AuthSessionChangedError({
        uid,
        message: "Your account was deleted, but your sign-in session changed.",
      });
    }

    const relay = dependencies.captureRelaySession(uid);
    yield* dependencies
      .signOut(uid)
      .pipe(Effect.onExit(() => clearDeletedUserData(uid, relay)));
  });

  return { completeSignIn, completeAccountDeletion };
}

export const completeSignIn = Effect.fn(
  "AuthSessionService.access.completeSignIn",
)(function* (uid: FirebaseUid) {
  const sessions = yield* AuthSessionService;
  return yield* sessions.completeSignIn(uid);
});

export const completeAccountDeletion = Effect.fn(
  "AuthSessionService.access.completeAccountDeletion",
)(function* (uid: FirebaseUid) {
  const sessions = yield* AuthSessionService;
  return yield* sessions.completeAccountDeletion(uid);
});
