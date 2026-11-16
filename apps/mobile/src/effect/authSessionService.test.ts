import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { vi } from "vitest";

import {
  AccountDeletionCleanupError,
  AccountDeletionSignOutError,
} from "@/effect/errors";
import { FirebaseUid } from "@/effect/schema";

import {
  AuthSessionService,
  completeAccountDeletion,
  makeAuthSessionService,
  type AuthSessionServiceDependencies,
} from "./authSessionService";

const uid = Schema.decodeUnknownSync(FirebaseUid)("user-1");

function makeHarness() {
  const state = { uid: uid as string | null };
  const clearRelay = vi.fn();
  const clearPersistence = vi.fn();
  const clearEmail = vi.fn();
  const relay = {
    isCurrent: () => true,
    readProfile: Effect.succeed({ uid }),
    clear: Effect.sync(clearRelay),
  };
  const signOut = vi.fn<AuthSessionServiceDependencies["signOut"]>(() =>
    Effect.sync(() => {
      state.uid = null;
    }),
  );
  const dependencies: AuthSessionServiceDependencies = {
    getCurrentUid: () => state.uid,
    subscribeAuthChanges: (onChange) => {
      onChange(state.uid);
      return () => undefined;
    },
    captureRelaySession: () => relay,
    signOut: (id) => Effect.suspend(() => signOut(id)),
    clearUserData: () => Effect.sync(clearPersistence),
    clearSignInEmail: () => Effect.sync(clearEmail),
  };
  const layer = Layer.succeed(
    AuthSessionService,
    makeAuthSessionService(dependencies),
  );
  return {
    state,
    signOut,
    clearRelay,
    clearPersistence,
    clearEmail,
    dependencies,
    layer,
  };
}

describe("AuthSessionService.completeAccountDeletion", () => {
  it.effect(
    "cleans up and preserves the deletion stage when sign-out fails",
    () =>
      Effect.gen(function* () {
        const h = makeHarness();
        const failure = new AccountDeletionSignOutError({
          uid,
          message: "Your account was deleted, but signing out failed.",
        });
        h.signOut.mockReturnValue(Effect.fail(failure));
        const error = yield* completeAccountDeletion(uid).pipe(
          Effect.provide(h.layer),
          Effect.flip,
        );
        assert.strictEqual(error, failure);
        assert.strictEqual(h.clearRelay.mock.calls.length, 1);
        assert.strictEqual(h.clearPersistence.mock.calls.length, 1);
        assert.strictEqual(h.clearEmail.mock.calls.length, 1);
      }),
  );

  it.effect(
    "does not sign out or clear another account after a session switch",
    () =>
      Effect.gen(function* () {
        const h = makeHarness();
        h.state.uid = "another-user";
        const error = yield* completeAccountDeletion(uid).pipe(
          Effect.provide(h.layer),
          Effect.flip,
        );
        assert.strictEqual(error._tag, "AuthSessionChangedError");
        assert.strictEqual(h.signOut.mock.calls.length, 0);
        assert.strictEqual(h.clearRelay.mock.calls.length, 0);
        assert.strictEqual(h.clearPersistence.mock.calls.length, 0);
      }),
  );

  it.effect("attempts remaining cleanup steps after a storage failure", () =>
    Effect.gen(function* () {
      const h = makeHarness();
      const failure = new AccountDeletionCleanupError({
        uid,
        operation: "persistence",
        message: "Your account was deleted, but clearing local data failed.",
      });
      const layer = Layer.succeed(
        AuthSessionService,
        makeAuthSessionService({
          ...h.dependencies,
          clearUserData: () => Effect.fail(failure),
        }),
      );
      const error = yield* completeAccountDeletion(uid).pipe(
        Effect.provide(layer),
        Effect.flip,
      );
      assert.strictEqual(error, failure);
      assert.strictEqual(h.state.uid, null);
      assert.strictEqual(h.clearRelay.mock.calls.length, 1);
      assert.strictEqual(h.clearEmail.mock.calls.length, 1);
    }),
  );
});
