import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Metric, Scope } from "effect";
import { TestClock } from "effect/testing";

import type { ConnectivityStatus } from "@/effect/connectivity";
import {
  RegisterPushTokenAbortedError,
  RegisterPushTokenRetryableError,
  RegisterPushTokenPermanentError,
  makePushRegistrationService,
  PushRegistrationStorageError,
  type PushRegistrationServiceDependencies,
} from "@/effect/pushRegistrationService";
import {
  makePushRegistrationStorage,
  PUSH_REGISTRATION_STORAGE_KEY,
} from "@/utils/pushRegistrationStorage";
import type {
  PushSubscriptionReceipt,
  PushSubscriptions,
} from "@/utils/pushSubscriptions";

const input = {
  token: "fcm-token",
  platform: "ios" as const,
  subscriptions: {
    channels: ["events", "announcements"],
    preferredCampus: { version: 0 },
  },
};

function makeHarness() {
  const values = new Map<string, string>();
  const confirmations: { token: string; uid: string }[] = [];
  let connectivity: ConnectivityStatus = "online";
  let currentUid: string | undefined = "user-1";
  type Execute = (
    ...args: Parameters<
      PushRegistrationServiceDependencies["executeRegistration"]
    >
  ) => Effect.Effect<
    void,
    import("@/effect/pushRegistrationService").RegisterPushTokenExecutionError
  >;
  let execute: Execute = () => Effect.void;
  let executeCount = 0;

  const dependencies: PushRegistrationServiceDependencies = {
    storage: makePushRegistrationStorage({
      getString: (key) => values.get(key),
      remove: (key) => {
        values.delete(key);
      },
      set: (key, value) => {
        values.set(key, value);
      },
    }),
    getCurrentAuthScope: () => (currentUid ? `uid:${currentUid}` : "anon"),
    getCurrentUid: () => currentUid,
    getConnectivityStatus: () => connectivity,
    getRetryDelayMs: () => 2_000,
    isDurableSyncEnabled: () => true,
    executeRegistration: (registration, signal) => {
      executeCount += 1;
      return execute(registration, signal).pipe(
        Effect.as({
          subscriptions: { channels: [], preferredCampus: { version: 2 } },
          topics: ["announcement", "campus-new-breed"],
        }),
      );
    },
    isRegistrationConfirmed: () => false,
    confirmRegistration: (registration, uid) => {
      confirmations.push({ token: registration.token, uid });
    },
  };

  return {
    confirmations,
    dependencies,
    getPending: () => {
      const result = dependencies.storage.read();
      return result.status === "pending" ? result.registration : null;
    },
    getExecuteCount: () => executeCount,
    setConnectivity: (status: ConnectivityStatus) => {
      connectivity = status;
    },
    setCurrentUid: (uid: string | undefined) => {
      currentUid = uid;
    },
    setExecute: (next: Execute) => {
      execute = next;
    },
    values,
  };
}

describe("PushRegistrationService", () => {
  it.effect("persists before attempting a push registration", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let persistedBeforeExecution = false;
      harness.setExecute(() =>
        Effect.sync(() => {
          persistedBeforeExecution = harness.values.has(
            PUSH_REGISTRATION_STORAGE_KEY,
          );
        }),
      );
      const service = yield* makePushRegistrationService(harness.dependencies);

      const result = yield* service.register(input);

      assert.strictEqual(result.status, "confirmed");
      assert.isTrue(persistedBeforeExecution);
      assert.strictEqual(harness.confirmations.length, 1);
      assert.isFalse(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
    }),
  );

  it.effect("does not report acceptance when durable persistence fails", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        storage: {
          ...harness.dependencies.storage,
          write: () => {
            throw new Error("disk full");
          },
        },
      });

      const error = yield* service.register(input).pipe(Effect.flip);

      assert.isTrue(error instanceof PushRegistrationStorageError);
      assert.strictEqual(error._tag, "OfflineMutationOutboxStorageError");
      assert.strictEqual(
        error.message,
        "Failed to write the offline mutation outbox",
      );
      assert.strictEqual(harness.getExecuteCount(), 0);
      assert.strictEqual(harness.confirmations.length, 0);
    }),
  );

  it.effect("queues offline without writing a false confirmation", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService(harness.dependencies);

      const result = yield* service.register(input);
      const pending = harness.getPending();

      assert.strictEqual(result.status, "queued");
      assert.strictEqual(harness.getExecuteCount(), 0);
      assert.strictEqual(harness.confirmations.length, 0);
      assert.strictEqual(pending?.token, "fcm-token");
      assert.strictEqual(pending?.authScope, "uid:user-1");
    }),
  );

  it.effect("coalesces to the latest desired registration", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService(harness.dependencies);

      yield* service.register(input);
      yield* service.register({
        ...input,
        token: "new-fcm-token",
        subscriptions: { channels: ["events"], preferredCampus: null },
      });
      const pending = harness.getPending();

      assert.strictEqual(pending?.token, "new-fcm-token");
      assert.deepStrictEqual(pending?.subscriptions, {
        channels: ["events"],
        preferredCampus: null,
      });
      assert.strictEqual(harness.values.size, 1);
    }),
  );

  it.effect("replays a pending registration after service reconstruction", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setConnectivity("offline");
      const firstService = yield* makePushRegistrationService(
        harness.dependencies,
      );
      yield* firstService.register(input);

      const replayed: PushSubscriptions[] = [];
      harness.setExecute((registration) =>
        Effect.sync(() => {
          replayed.push(registration.subscriptions);
        }),
      );
      harness.setConnectivity("online");
      const restartedService = yield* makePushRegistrationService(
        harness.dependencies,
      );
      const result = yield* restartedService.sync();

      assert.deepEqual(replayed, [
        {
          channels: ["announcements", "events"],
          preferredCampus: { version: 0 },
        },
      ]);
      assert.strictEqual(result.status, "confirmed");
      assert.strictEqual(harness.getExecuteCount(), 1);
      assert.deepStrictEqual(harness.confirmations, [
        { token: "fcm-token", uid: "user-1" },
      ]);
      assert.isFalse(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
    }),
  );

  it.effect("runs only one sync for concurrent callers", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService(harness.dependencies);
      yield* service.register(input);

      const release = yield* Deferred.make<void>();
      harness.setConnectivity("online");
      harness.setExecute(() => Deferred.await(release));

      const first = yield* service.sync().pipe(Effect.forkChild);
      const second = yield* service.sync().pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.strictEqual(harness.getExecuteCount(), 1);

      yield* Deferred.succeed(release, undefined);
      const firstResult = yield* Fiber.join(first);
      const secondResult = yield* Fiber.join(second);

      assert.strictEqual(firstResult.status, "confirmed");
      assert.strictEqual(secondResult.status, "unchanged");
      assert.strictEqual(harness.getExecuteCount(), 1);
    }),
  );

  it.effect("serializes concurrent submissions", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const releaseFirst = yield* Deferred.make<void>();
      harness.setExecute(() =>
        harness.getExecuteCount() === 1
          ? Deferred.await(releaseFirst)
          : Effect.void,
      );
      const service = yield* makePushRegistrationService(harness.dependencies);

      const first = yield* service
        .register(input)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;
      const second = yield* service
        .register({ ...input, token: "new-fcm-token" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;

      assert.strictEqual(harness.getExecuteCount(), 1);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      assert.strictEqual(harness.getExecuteCount(), 2);
      assert.deepStrictEqual(harness.confirmations, [
        { token: "fcm-token", uid: "user-1" },
        { token: "new-fcm-token", uid: "user-1" },
      ]);
      assert.isFalse(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
    }),
  );

  it.effect("cancels and purges an active sync on logout", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService(harness.dependencies);
      yield* service.register(input);

      let observedAbort = false;
      harness.setConnectivity("online");
      harness.setExecute((_registration, signal) =>
        Effect.callback<void>((resume) => {
          const onAbort = () => {
            observedAbort = true;
            resume(Effect.void);
          };
          signal.addEventListener("abort", onAbort, { once: true });
          return Effect.sync(() => {
            signal.removeEventListener("abort", onAbort);
          });
        }),
      );

      const syncing = yield* service.sync().pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* service.clear();
      yield* Fiber.join(syncing);

      assert.isTrue(observedAbort);
      assert.strictEqual(harness.confirmations.length, 0);
      assert.isFalse(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
    }),
  );

  it.effect("never replays an entry under a different account", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService(harness.dependencies);
      yield* service.register(input);

      harness.setCurrentUid("user-2");
      harness.setConnectivity("online");
      const result = yield* service.sync();

      assert.strictEqual(result.status, "ignored");
      assert.strictEqual(harness.getExecuteCount(), 0);
      assert.strictEqual(harness.confirmations.length, 0);
      assert.isFalse(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
    }),
  );

  it.effect("skips every local write when the account changes mid-flight", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService(harness.dependencies);
      yield* service.register(input);

      const release = yield* Deferred.make<void>();
      harness.setConnectivity("online");
      harness.setExecute(() => Deferred.await(release));
      const syncing = yield* service
        .sync()
        .pipe(Effect.forkChild({ startImmediately: true }));

      harness.setCurrentUid("user-2");
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(syncing);
      yield* Effect.yieldNow;

      assert.strictEqual(result.status, "ignored");
      assert.strictEqual(harness.confirmations.length, 0);
      assert.isFalse(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
    }),
  );

  it.effect("persists registration input without an authentication token", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService(harness.dependencies);

      yield* service.register(input);
      const raw = harness.values.get(PUSH_REGISTRATION_STORAGE_KEY) ?? "";

      assert.notMatch(raw, /authorization|accessToken|idToken/i);
      assert.match(raw, /"authScope":"uid:user-1"/);
    }),
  );
});

describe("push registration durability and retry", () => {
  it.effect(
    "retries once at the saved deadline despite repeated sync and register calls",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        harness.setExecute(() =>
          harness.getExecuteCount() === 1
            ? Effect.fail(
                new RegisterPushTokenRetryableError({ message: "offline" }),
              )
            : Effect.void,
        );
        const service = yield* makePushRegistrationService(
          harness.dependencies,
        );
        const first = yield* service.register(input);
        assert.deepEqual(first, { status: "queued", retryAtMs: 2_000 });
        assert.strictEqual(harness.getPending()?.attempt, 1);
        yield* service.sync();
        yield* service.register(input);
        yield* TestClock.adjust(1_999);
        assert.strictEqual(harness.getExecuteCount(), 1);
        yield* TestClock.adjust(1);
        assert.strictEqual(harness.getExecuteCount(), 2);
        assert.strictEqual(harness.confirmations.length, 1);
        assert.isNull(harness.getPending());
      }),
  );

  it.effect("honors Retry-After from response time, not request start", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setExecute(() =>
        harness.getExecuteCount() === 1
          ? Effect.sleep(5_000).pipe(
              Effect.andThen(
                Effect.fail(
                  new RegisterPushTokenRetryableError({
                    message: "rate limited",
                    retryAfterMs: 4_000,
                  }),
                ),
              ),
            )
          : Effect.void,
      );
      const service = yield* makePushRegistrationService(harness.dependencies);
      const request = yield* service.register(input).pipe(Effect.forkChild);
      yield* TestClock.adjust(5_000);
      assert.deepEqual(yield* Fiber.join(request), {
        status: "queued",
        retryAtMs: 9_000,
      });
      yield* TestClock.adjust(3_999);
      assert.strictEqual(harness.getExecuteCount(), 1);
      yield* TestClock.adjust(1);
      assert.strictEqual(harness.getExecuteCount(), 2);
    }),
  );

  it.effect(
    "preserves the retry deadline across service shutdown and restart",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        harness.setExecute(() =>
          Effect.fail(
            new RegisterPushTokenRetryableError({
              message: "network unavailable",
            }),
          ),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* makePushRegistrationService(
              harness.dependencies,
            );
            yield* service.register(input);
          }),
        );
        yield* TestClock.adjust(1_000);
        harness.setExecute(() => Effect.void);
        const restarted = yield* makePushRegistrationService(
          harness.dependencies,
        );
        assert.deepEqual(yield* restarted.sync(), {
          status: "queued",
          retryAtMs: 2_000,
        });
        assert.strictEqual(harness.getPending()?.attempt, 1);
        assert.strictEqual(harness.getExecuteCount(), 1);
        yield* TestClock.adjust(1_000);
        assert.strictEqual(harness.getExecuteCount(), 2);
        assert.isNull(harness.getPending());
      }),
  );

  it.effect("coalesces a retry to the latest token and subscriptions", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setExecute(() =>
        Effect.fail(
          new RegisterPushTokenRetryableError({
            message: "network unavailable",
          }),
        ),
      );
      const service = yield* makePushRegistrationService(harness.dependencies);
      yield* service.register(input);
      harness.setConnectivity("offline");
      yield* service.register({
        ...input,
        token: "rotated",
        subscriptions: { channels: ["news"], preferredCampus: null },
      });
      const pending = harness.getPending();
      assert.strictEqual(pending?.attempt, 0);
      assert.strictEqual(pending?.token, "rotated");
      harness.setExecute(() => Effect.void);
      harness.setConnectivity("online");
      yield* service.sync();
      yield* TestClock.adjust(2_000);
      assert.deepEqual(harness.confirmations, [
        { token: "rotated", uid: "user-1" },
      ]);
      assert.strictEqual(harness.getExecuteCount(), 2);
    }),
  );

  it.effect(
    "does not automatically replay permanent failures but allows a fresh registration",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        harness.setExecute(() =>
          Effect.fail(
            new RegisterPushTokenPermanentError({ message: "invalid token" }),
          ),
        );
        const service = yield* makePushRegistrationService(
          harness.dependencies,
        );
        assert.strictEqual((yield* service.register(input)).status, "failed");
        yield* TestClock.adjust(600_000);
        assert.strictEqual((yield* service.sync()).status, "failed");
        assert.strictEqual(harness.getExecuteCount(), 1);
        harness.setExecute(() => Effect.void);
        assert.strictEqual(
          (yield* service.register(input)).status,
          "confirmed",
        );
      }),
  );

  it.effect("purges scheduled retry work on logout", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setExecute(() =>
        Effect.fail(
          new RegisterPushTokenRetryableError({
            message: "network unavailable",
          }),
        ),
      );
      const service = yield* makePushRegistrationService(harness.dependencies);
      yield* service.register(input);
      yield* service.clear();
      harness.setCurrentUid("user-2");
      yield* TestClock.adjust(600_000);
      assert.strictEqual(harness.getExecuteCount(), 1);
      assert.strictEqual(harness.confirmations.length, 0);
      assert.isNull(harness.getPending());
    }),
  );

  it.effect(
    "stops a scheduled retry when its service scope closes without deleting pending work",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        harness.setExecute(() =>
          Effect.fail(
            new RegisterPushTokenRetryableError({
              message: "network unavailable",
            }),
          ),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* makePushRegistrationService(
              harness.dependencies,
            );
            yield* service.register(input);
          }),
        );
        yield* TestClock.adjust(600_000);
        assert.strictEqual(harness.getExecuteCount(), 1);
        assert.isTrue(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
      }),
  );

  it.effect("aborts an interrupted request and retains it for replay", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let signal: AbortSignal | undefined;
      harness.setExecute((_registration, nextSignal) => {
        signal = nextSignal;
        return Effect.never;
      });
      const service = yield* makePushRegistrationService(harness.dependencies);
      const request = yield* service
        .register(input)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Fiber.interrupt(request);
      assert.isTrue(signal?.aborted);
      assert.isTrue(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
      assert.strictEqual(harness.confirmations.length, 0);
      harness.setExecute(() => Effect.void);
      assert.strictEqual((yield* service.sync()).status, "confirmed");
    }),
  );

  it.effect("keeps pending work when persisting the server receipt fails", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let failWrite = true;
      const receipts: PushSubscriptionReceipt[] = [];
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        confirmRegistration: (_registration, _uid, receipt) => {
          if (failWrite) {
            throw new Error("disk full");
          }
          receipts.push(receipt);
        },
      });
      const error = yield* service.register(input).pipe(Effect.flip);
      assert.instanceOf(error, PushRegistrationStorageError);
      assert.isTrue(harness.values.has(PUSH_REGISTRATION_STORAGE_KEY));
      failWrite = false;
      yield* TestClock.adjust(1_999);
      assert.strictEqual(receipts.length, 0);
      yield* TestClock.adjust(1);
      assert.deepEqual(receipts, [
        {
          subscriptions: { channels: [], preferredCampus: { version: 2 } },
          topics: ["announcement", "campus-new-breed"],
        },
      ]);
      assert.isNull(harness.getPending());
    }),
  );

  it.effect(
    "retains online-only behavior when the durability gate is off",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        const service = yield* makePushRegistrationService({
          ...harness.dependencies,
          isDurableSyncEnabled: () => false,
        });
        harness.setConnectivity("offline");
        assert.strictEqual((yield* service.register(input)).status, "ignored");
        assert.strictEqual(harness.getExecuteCount(), 0);
        harness.setConnectivity("online");
        harness.setExecute(() =>
          Effect.fail(
            new RegisterPushTokenRetryableError({
              message: "network unavailable",
            }),
          ),
        );
        assert.strictEqual((yield* service.register(input)).status, "failed");
        assert.isNull(harness.getPending());
        yield* TestClock.adjust(600_000);
        assert.strictEqual(harness.getExecuteCount(), 1);
        harness.setExecute(() => Effect.void);
        assert.strictEqual(
          (yield* service.register(input)).status,
          "confirmed",
        );
        assert.strictEqual(harness.confirmations.length, 1);
      }),
  );

  it.effect(
    "continues durable retries after the rollout gate is disabled",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        let durable = true;
        harness.setExecute(() =>
          Effect.fail(
            new RegisterPushTokenRetryableError({
              message: "network unavailable",
            }),
          ),
        );
        const service = yield* makePushRegistrationService({
          ...harness.dependencies,
          isDurableSyncEnabled: () => durable,
        });
        yield* service.register(input);
        durable = false;
        const result = yield* service.register({
          ...input,
          token: "new-token",
        });
        assert.strictEqual(result.status, "queued");
        assert.strictEqual(harness.getPending()?.token, input.token);
        harness.setExecute(() => Effect.void);
        yield* TestClock.adjust(2_000);
        assert.strictEqual(harness.confirmations.length, 1);
        assert.isNull(harness.getPending());
        assert.strictEqual(
          (yield* service.register({ ...input, token: "new-token" })).status,
          "confirmed",
        );
      }),
  );

  it.effect(
    "separates guest registrations even when their Relay scope is shared",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        let authScope = "guest:guest-1";
        harness.setConnectivity("offline");
        const service = yield* makePushRegistrationService({
          ...harness.dependencies,
          getCurrentAuthScope: () => authScope,
        });
        yield* service.register(input);
        authScope = "guest:guest-2";
        harness.setConnectivity("online");
        assert.strictEqual((yield* service.sync()).status, "ignored");
        assert.strictEqual(harness.getExecuteCount(), 0);
        assert.isNull(harness.getPending());
      }),
  );
});

it.effect.each([true, false])(
  "service disposal aborts the active registration (durable: %s)",
  (durable) =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let aborted = false;
      harness.setExecute((_registration, signal) =>
        Effect.callback<void>((resume) => {
          const onAbort = () => {
            aborted = true;
            resume(Effect.void);
          };
          signal.addEventListener("abort", onAbort, { once: true });
          return Effect.sync(() => {
            signal.removeEventListener("abort", onAbort);
          });
        }),
      );
      const scope = yield* Scope.make();
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        isDurableSyncEnabled: () => durable,
      }).pipe(Effect.provideService(Scope.Scope, scope));
      const request = yield* service
        .register(input)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Scope.close(scope, Exit.succeed(undefined));
      assert.strictEqual((yield* Fiber.join(request)).status, "ignored");
      assert.isTrue(aborted);
      assert.strictEqual(harness.confirmations.length, 0);
      assert.strictEqual(
        harness.values.has(PUSH_REGISTRATION_STORAGE_KEY),
        durable,
      );
    }),
);

it.effect("cancels retry work even when clearing durable storage fails", () =>
  Effect.gen(function* () {
    const harness = makeHarness();
    harness.setExecute(() =>
      Effect.fail(
        new RegisterPushTokenRetryableError({ message: "network unavailable" }),
      ),
    );
    const service = yield* makePushRegistrationService({
      ...harness.dependencies,
      storage: {
        ...harness.dependencies.storage,
        clear: () => {
          throw new Error("storage unavailable");
        },
      },
    });
    yield* service.register(input);
    assert.instanceOf(
      yield* service.clear().pipe(Effect.flip),
      PushRegistrationStorageError,
    );
    yield* TestClock.adjust(600_000);
    assert.strictEqual(harness.getExecuteCount(), 1);
    assert.strictEqual(harness.confirmations.length, 0);
  }),
);

it.effect(
  "an already-confirmed registration removes obsolete pending work",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let confirmed = false;
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        isRegistrationConfirmed: () => confirmed,
      });
      yield* service.register({ ...input, token: "obsolete-token" });
      confirmed = true;
      assert.strictEqual((yield* service.register(input)).status, "unchanged");
      assert.isNull(harness.getPending());
      assert.strictEqual(harness.getExecuteCount(), 0);
    }),
);

it.effect(
  "logout blocks queued and later registrations until identity changes",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setExecute((_registration, signal) =>
        Effect.callback<void>((resume) => {
          const abort = () => {
            resume(Effect.void);
          };
          signal.addEventListener("abort", abort, { once: true });
          return Effect.sync(() => {
            signal.removeEventListener("abort", abort);
          });
        }),
      );
      const service = yield* makePushRegistrationService(harness.dependencies);
      const active = yield* service
        .register(input)
        .pipe(Effect.forkChild({ startImmediately: true }));
      const queued = yield* service
        .register({ ...input, token: "late-token" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* service.clear();
      harness.setExecute(() => Effect.void);
      assert.strictEqual((yield* Fiber.join(active)).status, "ignored");
      assert.strictEqual((yield* Fiber.join(queued)).status, "ignored");
      assert.strictEqual((yield* service.register(input)).status, "ignored");
      assert.strictEqual((yield* service.sync()).status, "ignored");
      assert.strictEqual(harness.getExecuteCount(), 1);
      assert.strictEqual(harness.values.size, 0);
      harness.setCurrentUid("user-2");
      assert.strictEqual((yield* service.register(input)).status, "confirmed");
      harness.setCurrentUid("user-1");
      assert.strictEqual((yield* service.register(input)).status, "confirmed");
    }),
);

it.effect(
  "a stale permanent failure cannot reject the new token with the gate off",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let durable = true;
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        isDurableSyncEnabled: () => durable,
      });
      yield* service.register(input);
      durable = false;
      harness.setConnectivity("online");
      harness.setExecute((registration) =>
        registration.token === input.token
          ? Effect.fail(
              new RegisterPushTokenPermanentError({
                message: "obsolete token",
              }),
            )
          : Effect.void,
      );
      assert.strictEqual(
        (yield* service.register({ ...input, token: "new-token" })).status,
        "confirmed",
      );
      assert.deepEqual(harness.confirmations, [
        { token: "new-token", uid: "user-1" },
      ]);
      assert.strictEqual(harness.getExecuteCount(), 2);
    }),
);

it.effect(
  "retries executor-reported cancellation while the identity is still current",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.setExecute(() =>
        harness.getExecuteCount() === 1
          ? Effect.fail(
              new RegisterPushTokenAbortedError({
                message: "Relay canceled the request",
              }),
            )
          : Effect.void,
      );
      const service = yield* makePushRegistrationService(harness.dependencies);
      assert.deepEqual(yield* service.register(input), {
        status: "queued",
        retryAtMs: 2_000,
      });
      assert.strictEqual(harness.getPending()?.attempt, 1);
      yield* TestClock.adjust(2_000);
      assert.strictEqual(harness.getExecuteCount(), 2);
      assert.strictEqual(harness.confirmations.length, 1);
      assert.isNull(harness.getPending());
    }),
);

it.effect.each(["read", "receipt"])(
  "automatically recovers repeated %s failures inside the retry worker",
  (operation) =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let storageUnavailable = false;
      harness.setExecute(() =>
        harness.getExecuteCount() === 1
          ? Effect.fail(
              new RegisterPushTokenRetryableError({
                message: "network unavailable",
              }),
            )
          : Effect.void,
      );
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        getRetryDelayMs: (attempt) => attempt * 1_000,
        storage: {
          ...harness.dependencies.storage,
          read: () => {
            if (storageUnavailable && operation === "read") {
              throw new Error("storage unavailable");
            }
            return harness.dependencies.storage.read();
          },
        },
        confirmRegistration: (...args) => {
          if (storageUnavailable && operation === "receipt") {
            throw new Error("storage unavailable");
          }
          harness.dependencies.confirmRegistration(...args);
        },
      });
      yield* service.register(input);
      storageUnavailable = true;
      yield* TestClock.adjust(1_000);
      assert.strictEqual(harness.confirmations.length, 0);
      yield* TestClock.adjust(1_000);
      storageUnavailable = false;
      yield* TestClock.adjust(1_999);
      assert.strictEqual(harness.confirmations.length, 0);
      yield* TestClock.adjust(1);
      assert.strictEqual(harness.confirmations.length, 1);
      assert.isNull(harness.getPending());
    }),
);

it.effect(
  "logout cancels a storage recovery retry without allowing the same scope to resume",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        confirmRegistration: () => {
          throw new Error("disk full");
        },
      });
      yield* service.register(input).pipe(Effect.flip);
      yield* service.clear();
      yield* TestClock.adjust(600_000);
      assert.strictEqual((yield* service.register(input)).status, "ignored");
      assert.strictEqual(harness.getExecuteCount(), 1);
      assert.isNull(harness.getPending());
    }),
);

const outcomeCount = (outcome: string) =>
  Metric.value(
    Metric.counter("offline_mutation_outbox_outcome_total", {
      description: "Durable offline mutation outcomes",
      incremental: true,
    }).pipe(Metric.withAttributes({ command: "registerPushToken", outcome })),
  );

it.effect("scope discards do not count as explicit logout clears", () =>
  Effect.gen(function* () {
    const harness = makeHarness();
    harness.setConnectivity("offline");
    const service = yield* makePushRegistrationService(harness.dependencies);
    yield* service.register(input);
    harness.setCurrentUid("user-2");
    yield* service.sync();
    assert.strictEqual(
      (yield* outcomeCount("discarded_scope_mismatch")).count,
      1,
    );
    assert.strictEqual((yield* outcomeCount("cleared")).count, 0);
    yield* service.register(input);
    yield* service.clear();
    assert.strictEqual((yield* outcomeCount("cleared")).count, 1);
    assert.strictEqual(
      (yield* outcomeCount("discarded_scope_mismatch")).count,
      1,
    );
  }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);

it.effect("records each invalid persisted registration discard once", () =>
  Effect.gen(function* () {
    const harness = makeHarness();
    harness.values.set(PUSH_REGISTRATION_STORAGE_KEY, "{corrupt");
    const service = yield* makePushRegistrationService(harness.dependencies);
    yield* service.sync();
    yield* service.sync();
    assert.strictEqual((yield* outcomeCount("discarded_invalid")).count, 1);
    assert.strictEqual((yield* outcomeCount("cleared")).count, 0);
    assert.strictEqual(harness.values.size, 0);
  }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);

it.effect.each([false, true])(
  "uses two reads and preserves external-clear protection (clear: %s)",
  (externallyCleared) =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let reads = 0;
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        storage: {
          ...harness.dependencies.storage,
          read: () => {
            reads += 1;
            return harness.dependencies.storage.read();
          },
        },
      });
      if (externallyCleared) {
        harness.setExecute(() =>
          Effect.sync(() => {
            harness.values.clear();
          }),
        );
      }
      const result = yield* service.register(input);
      assert.strictEqual(
        result.status,
        externallyCleared ? "ignored" : "confirmed",
      );
      assert.strictEqual(
        harness.confirmations.length,
        externallyCleared ? 0 : 1,
      );
      assert.strictEqual(reads, 2);
    }),
);

it.effect(
  "a discarded stale item cannot prevent a new online-only registration",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let durable = true;
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        isDurableSyncEnabled: () => durable,
      });
      yield* service.register(input);
      durable = false;
      harness.setConnectivity("online");
      harness.setExecute((registration) =>
        Effect.sync(() => {
          if (registration.token === input.token) {
            harness.values.clear();
          }
        }),
      );
      assert.strictEqual(
        (yield* service.register({ ...input, token: "new-token" })).status,
        "confirmed",
      );
      assert.deepEqual(harness.confirmations, [
        { token: "new-token", uid: "user-1" },
      ]);
    }),
);

it.effect(
  "a permanent failure for the requested token is not immediately attempted twice",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      let durable = true;
      harness.setConnectivity("offline");
      const service = yield* makePushRegistrationService({
        ...harness.dependencies,
        isDurableSyncEnabled: () => durable,
      });
      yield* service.register(input);
      durable = false;
      harness.setConnectivity("online");
      harness.setExecute(() =>
        Effect.fail(
          new RegisterPushTokenPermanentError({ message: "invalid token" }),
        ),
      );
      assert.strictEqual((yield* service.register(input)).status, "failed");
      assert.strictEqual(harness.getExecuteCount(), 1);
    }),
);
