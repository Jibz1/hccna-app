import { Predicate, Context, Effect, Schema } from "effect";
import type { AppleAuthenticationFullName } from "expo-apple-authentication";

import type { UnsupportedAuthProviderError } from "@/effect/errors";
import {
  AppleSignInUnsupportedError,
  AuthProviderOperationError,
  AuthSessionChangedError,
  AuthUserNotFoundError,
  ProviderTokenMissingError,
  UserDocumentReadError,
  UserDocumentTimeoutError,
} from "@/effect/errors";
import type { UserDocType } from "@/types/userdoc";
import type { EnsureUserProfileOutcome } from "@/utils/ensureUserProfileCore";

import { FirebaseUid } from "./schema";

export type SocialProvider = "apple" | "google" | "password" | "firebase";
export type SignInProvider = Extract<SocialProvider, "apple" | "google">;
export type SocialProviderType =
  | "apple.com"
  | "google.com"
  | "password"
  | "firebase";

type FirebaseUser = {
  readonly uid?: string | null;
  readonly providerId?: string | null;
};

type FirebaseAuthClient = {
  readonly currentUser: FirebaseUser | null;
  readonly signOut: () => Promise<void>;
};

type AppleTokenAndNonce = {
  readonly identityToken: string;
  readonly rawNonce: string;
  readonly hashedNonce: string;
  readonly fullName?: AppleAuthenticationFullName;
};

type GoogleToken = {
  readonly identityToken: string;
  readonly accessToken: string;
};

type SignInResponse = {
  readonly user?: FirebaseUser | null;
};

type AppleSignInResponse = {
  readonly identityToken?: string | null;
  readonly fullName?: AppleAuthenticationFullName | null;
};

type GoogleSignInResponse = {
  readonly type?: string;
  readonly data?: {
    readonly idToken?: string | null;
  } | null;
};

type GoogleTokensResponse = {
  readonly idToken: string;
  readonly accessToken: string;
};

type AuthCredential = Parameters<
  typeof import("@react-native-firebase/auth").signInWithCredential
>[1];

export type AuthServiceError =
  | AuthSessionChangedError
  | AppleSignInUnsupportedError
  | AuthProviderOperationError
  | AuthUserNotFoundError
  | ProviderTokenMissingError
  | UnsupportedAuthProviderError
  | UserDocumentReadError
  | UserDocumentTimeoutError;

type AuthEffect<A> = Effect.Effect<A, AuthServiceError>;

export type AuthServiceApi = {
  readonly generateAppleTokenAndNonce: () => AuthEffect<AppleTokenAndNonce>;
  readonly generateGoogleToken: () => AuthEffect<GoogleToken>;
  readonly waitForUserDocument: (uid: FirebaseUid) => AuthEffect<UserDocType>;
  readonly signInFromProvider: (
    provider: SignInProvider,
  ) => AuthEffect<FirebaseUid>;
  readonly signOutFromProvider: (
    provider: SocialProvider,
    uid: string,
  ) => AuthEffect<void>;
  readonly deleteUserFromProvider: (providerId: string) => AuthEffect<void>;
};

export type AuthServiceDependencies = {
  readonly platformOS: string;
  readonly makeRawNonce: () => string;
  readonly hashNonce: (nonce: string) => Promise<string>;
  readonly signInWithApple: (nonce: string) => Promise<AppleSignInResponse>;
  readonly hasGooglePlayServices: () => Promise<void>;
  readonly signInSilentlyWithGoogle: () => Promise<GoogleSignInResponse>;
  readonly signInWithGoogle: () => Promise<GoogleSignInResponse>;
  readonly getGoogleTokens: () => Promise<GoogleTokensResponse>;
  readonly signOutWithGoogle: () => Promise<void>;
  readonly makeAppleCredential: (
    identityToken: string,
    rawNonce: string,
    fullName?: AppleAuthenticationFullName,
  ) => AuthCredential;
  readonly makeGoogleCredential: (
    identityToken: string,
    accessToken: string,
  ) => AuthCredential;
  readonly getAuth: () => FirebaseAuthClient;
  readonly signInWithCredential: (
    auth: FirebaseAuthClient,
    credential: AuthCredential,
  ) => Promise<SignInResponse>;
  readonly reauthenticateWithCredential: (
    user: FirebaseUser,
    credential: AuthCredential,
  ) => Promise<void>;
  readonly deleteUser: (user: FirebaseUser) => Promise<void>;
  readonly subscribeUserDocument: (
    uid: FirebaseUid,
    onDocument: (doc: UserDocType) => void,
    onError: (cause: unknown) => void,
  ) => () => void;
  readonly ensureUserProfile: () => Promise<EnsureUserProfileOutcome>;
  readonly userDocumentTimeoutMs: number;
};

export class AuthService extends Context.Service<AuthService, AuthServiceApi>()(
  "AuthService",
) {}

const providerOperationError = (
  provider: string,
  operation: string,
  cause: unknown,
) =>
  new AuthProviderOperationError({
    provider,
    operation,
    message: getUnknownMessage(cause, `${provider} ${operation} failed`),
    cause,
  });

function getUnknownMessage(cause: unknown, fallback: string): string {
  if (
    Predicate.isObjectOrArray(cause) &&
    "message" in cause &&
    Predicate.isString(cause.message) &&
    cause.message.length > 0
  ) {
    return cause.message;
  }

  return fallback;
}

function decodeFirebaseUid(
  uid: string | null | undefined,
  provider?: string,
): AuthEffect<FirebaseUid> {
  if (!uid) {
    return Effect.fail(
      new AuthUserNotFoundError({
        provider,
        message: "User not found",
      }),
    );
  }

  return Schema.decodeUnknownEffect(FirebaseUid)(uid).pipe(
    Effect.mapError(
      () =>
        new AuthUserNotFoundError({
          provider,
          message: "User not found",
        }),
    ),
  );
}

export function makeAuthService(
  dependencies: AuthServiceDependencies,
): AuthServiceApi {
  const generateAppleTokenAndNonce = Effect.fn(
    "AuthService.generateAppleTokenAndNonce",
  )(function* () {
    if (dependencies.platformOS !== "ios") {
      return yield* new AppleSignInUnsupportedError({
        platform: dependencies.platformOS,
        message: "Apple Sign-In is only supported on iOS",
      });
    }

    const rawNonce = dependencies.makeRawNonce();
    const hashedNonce = yield* Effect.tryPromise({
      try: () => dependencies.hashNonce(rawNonce),
      catch: (cause) => providerOperationError("apple", "hashNonce", cause),
    });
    const response = yield* Effect.tryPromise({
      try: () => dependencies.signInWithApple(hashedNonce),
      catch: (cause) => providerOperationError("apple", "signIn", cause),
    });

    if (!response.identityToken) {
      return yield* new ProviderTokenMissingError({
        provider: "apple",
        message: "Apple Sign-In failed - no identity token returned",
      });
    }

    return {
      identityToken: response.identityToken,
      rawNonce,
      hashedNonce,
      fullName: response.fullName ?? undefined,
    };
  });

  const generateGoogleToken = Effect.fn("AuthService.generateGoogleToken")(
    function* () {
      yield* Effect.tryPromise({
        try: dependencies.hasGooglePlayServices,
        catch: () => undefined,
      }).pipe(Effect.ignore);

      const response = yield* Effect.tryPromise({
        try: async () => {
          const silent = await dependencies.signInSilentlyWithGoogle();
          return silent?.type === "success"
            ? silent
            : await dependencies.signInWithGoogle();
        },
        catch: (cause) => providerOperationError("google", "signIn", cause),
      });

      const identityToken = response.data?.idToken;
      if (!identityToken) {
        return yield* new ProviderTokenMissingError({
          provider: "google",
          message: "Google Sign-In failed - no identity token returned",
        });
      }

      const tokens = yield* Effect.tryPromise({
        try: dependencies.getGoogleTokens,
        catch: (cause) => providerOperationError("google", "getTokens", cause),
      });
      if (!tokens.accessToken) {
        return yield* new ProviderTokenMissingError({
          provider: "google",
          message: "Google Sign-In failed - no access token returned",
        });
      }

      return { identityToken, accessToken: tokens.accessToken };
    },
  );

  const waitForUserDocument = Effect.fn("AuthService.waitForUserDocument")(
    (uid: FirebaseUid) =>
      Effect.callback<
        UserDocType,
        UserDocumentReadError | UserDocumentTimeoutError
      >((resume, signal) => {
        let completed = false;
        let unsubscribe: (() => void) | undefined;

        const timer = setTimeout(() => {
          if (completed) {
            return;
          }

          completed = true;
          unsubscribe?.();
          resume(
            Effect.fail(
              new UserDocumentTimeoutError({
                uid,
                timeoutMs: dependencies.userDocumentTimeoutMs,
                message: "Timeout: User document was not created in time.",
              }),
            ),
          );
        }, dependencies.userDocumentTimeoutMs);

        const cleanup = () => {
          clearTimeout(timer);
          unsubscribe?.();
        };

        signal.addEventListener("abort", cleanup, { once: true });

        try {
          unsubscribe = dependencies.subscribeUserDocument(
            uid,
            (doc) => {
              if (completed) {
                return;
              }

              completed = true;
              cleanup();
              resume(Effect.succeed(doc));
            },
            (cause) => {
              if (completed) {
                return;
              }

              completed = true;
              cleanup();
              resume(
                Effect.fail(
                  new UserDocumentReadError({
                    uid,
                    message: getUnknownMessage(
                      cause,
                      "Error waiting for user document",
                    ),
                    cause,
                  }),
                ),
              );
            },
          );
        } catch (cause) {
          completed = true;
          cleanup();
          resume(
            Effect.fail(
              new UserDocumentReadError({
                uid,
                message: getUnknownMessage(
                  cause,
                  "Error waiting for user document",
                ),
                cause,
              }),
            ),
          );
        }

        return Effect.sync(cleanup);
      }),
  );

  const provisionUserProfile = Effect.fn("AuthService.provisionUserProfile")(
    function* () {
      const outcome = yield* Effect.tryPromise({
        try: () => dependencies.ensureUserProfile(),
        catch: (cause) =>
          providerOperationError("firebase", "ensureUserProfile", cause),
      });

      if (!outcome.success) {
        return yield* Effect.fail(
          providerOperationError(
            "firebase",
            "ensureUserProfile",
            new Error(outcome.message || "ensureUserProfile failed"),
          ),
        );
      }
    },
  );

  const provisionOrLegacyWait = (uid: FirebaseUid) =>
    provisionUserProfile().pipe(
      Effect.map(() => uid),
      Effect.catch(() => waitForUserDocument(uid).pipe(Effect.map(() => uid))),
    );

  const signInWithApple = Effect.fn("AuthService.signInWithApple")(
    function* () {
      const { identityToken, rawNonce, fullName } =
        yield* generateAppleTokenAndNonce();
      const credential = dependencies.makeAppleCredential(
        identityToken,
        rawNonce,
        // Apple supplies the name only on first authorization. Save it in
        // Firebase before the backend provisions the profile.
        fullName,
      );
      const userCredential = yield* Effect.tryPromise({
        try: () =>
          dependencies.signInWithCredential(dependencies.getAuth(), credential),
        catch: (cause) =>
          providerOperationError("apple", "signInWithCredential", cause),
      });
      const uid = yield* decodeFirebaseUid(userCredential.user?.uid, "apple");

      return yield* provisionOrLegacyWait(uid);
    },
  );

  const signInWithGoogle = Effect.fn("AuthService.signInWithGoogle")(
    function* () {
      const { identityToken, accessToken } = yield* generateGoogleToken();
      const credential = dependencies.makeGoogleCredential(
        identityToken,
        accessToken,
      );
      const userCredential = yield* Effect.tryPromise({
        try: () =>
          dependencies.signInWithCredential(dependencies.getAuth(), credential),
        catch: (cause) =>
          providerOperationError("google", "signInWithCredential", cause),
      });
      const uid = yield* decodeFirebaseUid(userCredential.user?.uid, "google");

      return yield* provisionOrLegacyWait(uid);
    },
  );

  const signOutFromAuth = Effect.fn("AuthService.signOutFromAuth")(function* (
    uid: string,
  ) {
    const auth = dependencies.getAuth();
    if (auth.currentUser && auth.currentUser.uid !== uid) {
      return yield* new AuthSessionChangedError({
        uid: yield* decodeFirebaseUid(uid, "firebase"),
        message: "Your sign-in session changed. Please try again.",
      });
    }

    if (!auth.currentUser) {
      yield* Effect.log("User not signed in");
      return;
    }

    yield* Effect.tryPromise({
      try: () => auth.signOut(),
      catch: (cause) => providerOperationError("firebase", "signOut", cause),
    });
  });

  const signOutWithGoogle = Effect.fn("AuthService.signOutWithGoogle")(
    function* (uid: string) {
      yield* Effect.tryPromise({
        try: dependencies.signOutWithGoogle,
        catch: (cause) => providerOperationError("google", "signOut", cause),
      }).pipe(
        Effect.catchTag("AuthProviderOperationError", (error) =>
          Effect.log("Failed to sign out with Google", {
            message: error.message,
          }),
        ),
      );

      return yield* signOutFromAuth(uid);
    },
  );

  const signInFromProvider = Effect.fn("AuthService.signInFromProvider")(
    function* (provider: SignInProvider) {
      switch (provider) {
        case "apple":
          return yield* signInWithApple();
        case "google":
          return yield* signInWithGoogle();
      }
    },
  );

  const signOutFromProvider = Effect.fn("AuthService.signOutFromProvider")(
    function* (provider: SocialProvider, uid: string) {
      const current = dependencies.getAuth().currentUser;
      if (current && current.uid !== uid) {
        return yield* new AuthSessionChangedError({
          uid: yield* decodeFirebaseUid(uid, "firebase"),
          message: "Your sign-in session changed. Please try again.",
        });
      }
      switch (provider) {
        case "apple":
          // Apple's signOutAsync opens an authentication modal; Firebase
          // sign-out is sufficient to end this app's Apple session.
          return yield* signOutFromAuth(uid);
        case "google":
          return yield* signOutWithGoogle(uid);
        case "password":
        case "firebase":
          return yield* signOutFromAuth(uid);
        default:
          return yield* signOutFromAuth(uid);
      }
    },
  );

  const deleteUserFromProvider = Effect.fn(
    "AuthService.deleteUserFromProvider",
  )(function* (providerId: string) {
    const auth = dependencies.getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser?.uid) {
      return yield* new AuthUserNotFoundError({
        provider: providerId,
        message: "User not found",
      });
    }

    if (providerId === "apple.com") {
      const { identityToken, rawNonce } = yield* generateAppleTokenAndNonce();
      const credential = dependencies.makeAppleCredential(
        identityToken,
        rawNonce,
      );
      yield* Effect.tryPromise({
        try: () =>
          dependencies.reauthenticateWithCredential(currentUser, credential),
        catch: (cause) =>
          providerOperationError("apple", "reauthenticate", cause),
      });
    } else if (providerId === "google.com") {
      const { identityToken, accessToken } = yield* generateGoogleToken();
      const credential = dependencies.makeGoogleCredential(
        identityToken,
        accessToken,
      );
      yield* Effect.tryPromise({
        try: () =>
          dependencies.reauthenticateWithCredential(currentUser, credential),
        catch: (cause) =>
          providerOperationError("google", "reauthenticate", cause),
      });
    }

    yield* Effect.tryPromise({
      try: () => dependencies.deleteUser(currentUser),
      catch: (cause) => providerOperationError(providerId, "deleteUser", cause),
    });
  });

  return {
    generateAppleTokenAndNonce,
    generateGoogleToken,
    waitForUserDocument,
    signInFromProvider,
    signOutFromProvider,
    deleteUserFromProvider,
  };
}

export const signInFromProvider = Effect.fn(
  "AuthService.access.signInFromProvider",
)(function* (provider: SignInProvider) {
  const auth = yield* AuthService;
  return yield* auth.signInFromProvider(provider);
});

export const signOutFromProvider = Effect.fn(
  "AuthService.access.signOutFromProvider",
)(function* (provider: SocialProvider, uid: string) {
  const auth = yield* AuthService;
  return yield* auth.signOutFromProvider(provider, uid);
});

export const deleteUserFromProvider = Effect.fn(
  "AuthService.access.deleteUserFromProvider",
)(function* (providerId: string) {
  const auth = yield* AuthService;
  return yield* auth.deleteUserFromProvider(providerId);
});

export const waitForUserDocument = Effect.fn(
  "AuthService.access.waitForUserDocument",
)(function* (uid: FirebaseUid) {
  const auth = yield* AuthService;
  return yield* auth.waitForUserDocument(uid);
});
