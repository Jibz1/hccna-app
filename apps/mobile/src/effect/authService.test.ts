import { Effect, Layer } from "effect";
import { describe, expect, test, vi } from "vitest";

import {
  AuthService,
  AuthServiceDependencies,
  deleteUserFromProvider,
  makeAuthService,
  signOutFromProvider,
} from "./authService";

const userDoc = {
  uid: "user-1",
  email: "user@example.com",
} as any;

function makeCredential(provider: string) {
  return {
    provider,
    providerId: provider,
    signInMethod: provider,
    token: "token",
    secret: "secret",
    toJSON: () => ({ provider }),
  };
}

function makeDependencies(
  overrides: Partial<AuthServiceDependencies> = {},
): AuthServiceDependencies {
  let currentUser = { uid: "user-1", providerId: "google.com" };

  return {
    platformOS: "ios",
    makeRawNonce: () => "raw-nonce",
    hashNonce: async () => "hashed-nonce",
    signInWithApple: async () => ({ identityToken: "apple-token" }),
    hasGooglePlayServices: async () => undefined,
    signInSilentlyWithGoogle: async () => ({
      type: "success",
      data: { idToken: "google-token" },
    }),
    signInWithGoogle: async () => ({
      type: "success",
      data: { idToken: "interactive-google-token" },
    }),
    getGoogleTokens: async () => ({
      idToken: "google-token",
      accessToken: "google-access-token",
    }),
    signOutWithGoogle: async () => undefined,
    makeAppleCredential: () => makeCredential("apple"),
    makeGoogleCredential: () => makeCredential("google"),
    getAuth: () => ({
      currentUser,
      signOut: async () => {
        currentUser = null as any;
      },
    }),
    signInWithCredential: async () => ({ user: currentUser }),
    reauthenticateWithCredential: async () => undefined,
    deleteUser: async () => undefined,
    subscribeUserDocument: (_uid, onDocument) => {
      onDocument(userDoc);
      return () => undefined;
    },
    ensureUserProfile: async () => ({
      success: true,
      created: true,
      message: "User created successfully",
    }),
    userDocumentTimeoutMs: 10,
    ...overrides,
  };
}

function provideAuth(dependencies: AuthServiceDependencies) {
  return Layer.succeed(AuthService, makeAuthService(dependencies));
}

describe("AuthService", () => {
  test("signs out using provider cleanup and Firebase auth", async () => {
    const signOutWithGoogle = vi.fn(async () => undefined);

    await Effect.runPromise(
      signOutFromProvider("google", "user-1").pipe(
        Effect.provide(
          provideAuth(
            makeDependencies({
              signOutWithGoogle,
            }),
          ),
        ),
      ),
    );

    expect(signOutWithGoogle).toHaveBeenCalledTimes(1);
  });

  test("still signs out of Firebase when Google cleanup fails", async () => {
    const signOut = vi.fn(async () => undefined);
    await Effect.runPromise(
      signOutFromProvider("google", "user-1").pipe(
        Effect.provide(
          provideAuth(
            makeDependencies({
              signOutWithGoogle: async () => {
                throw new Error("provider unavailable");
              },
              getAuth: () => ({ currentUser: { uid: "user-1" }, signOut }),
            }),
          ),
        ),
      ),
    );
    expect(signOut).toHaveBeenCalledOnce();
  });
  test("does not sign out another account after asynchronous provider cleanup", async () => {
    const signOut = vi.fn(async () => undefined);
    let uid = "user-1";
    const result = await Effect.runPromise(
      signOutFromProvider("google", uid).pipe(
        Effect.provide(
          provideAuth(
            makeDependencies({
              signOutWithGoogle: async () => {
                uid = "user-2";
              },
              getAuth: () => ({ currentUser: { uid }, signOut }),
            }),
          ),
        ),
        Effect.flip,
      ),
    );
    expect(result._tag).toBe("AuthSessionChangedError");
    expect(signOut).not.toHaveBeenCalled();
  });

  test("reauthenticates the current Apple user before deleting it", async () => {
    const currentUser = { uid: "user-1", providerId: "apple.com" };
    const credential = makeCredential("apple");
    const auth = {
      currentUser,
      signOut: async () => undefined,
    };
    const signInWithCredential = vi.fn(async () => ({
      user: { uid: "other-user", providerId: "apple.com" },
    }));
    const reauthenticateWithCredential = vi.fn(async () => undefined);
    const deleteUser = vi.fn(async () => undefined);

    await Effect.runPromise(
      deleteUserFromProvider("apple.com").pipe(
        Effect.provide(
          provideAuth(
            makeDependencies({
              getAuth: () => auth,
              makeAppleCredential: () => credential,
              signInWithCredential,
              reauthenticateWithCredential,
              deleteUser,
            }),
          ),
        ),
      ),
    );

    expect(signInWithCredential).not.toHaveBeenCalled();
    expect(reauthenticateWithCredential).toHaveBeenCalledWith(
      currentUser,
      credential,
    );
    expect(deleteUser).toHaveBeenCalledWith(currentUser);
  });
});
