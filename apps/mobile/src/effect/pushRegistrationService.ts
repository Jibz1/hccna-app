import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  Metric,
  Option,
  Schema,
  Scope,
  Semaphore,
} from "effect";

import type { ConnectivityStatus } from "@/effect/connectivity";
import { NonNegativeInt } from "@/effect/schema";
import { FEATURE_GATES } from "@/featureGates/names";
import type {
  PendingPushRegistration,
  PushRegistration,
  PushRegistrationInput,
  PushRegistrationStorage,
} from "@/utils/pushRegistrationStorage";
import {
  normalizePushSubscriptions,
  pushSubscriptionsKey,
  type PushSubscriptionReceipt,
} from "@/utils/pushSubscriptions";

export const REGISTER_PUSH_TOKEN_TIMEOUT_MS = 15_000;
// Launch and resume send a burst of screen queries while iOS may still be
// replacing connections, so registration waits for the app to settle first.
export const PUSH_REGISTRATION_SETTLE_MS = 5_000;
// Preserve the deployed rollout switch and metric names.
export const PUSH_REGISTRATION_DURABILITY_GATE = FEATURE_GATES.pushTokenOutbox;

export type PushRegistrationResult = {
  readonly status: "confirmed" | "failed" | "ignored" | "queued" | "unchanged";
  readonly retryAtMs?: number;
};

// Keep the deployed error tag/message for existing telemetry filters.
export class PushRegistrationStorageError extends Schema.TaggedError<PushRegistrationStorageError>()(
  "OfflineMutationOutboxStorageError",
  {
    operation: Schema.Literals(["read", "remove", "write"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class RegisterPushTokenRetryableError extends Schema.TaggedError<RegisterPushTokenRetryableError>()(
  "RegisterPushTokenRetryableError",
  {
    message: Schema.String,
    retryAfterMs: Schema.optional(NonNegativeInt),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class RegisterPushTokenPermanentError extends Schema.TaggedError<RegisterPushTokenPermanentError>()(
  "RegisterPushTokenPermanentError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export class RegisterPushTokenAbortedError extends Schema.TaggedError<RegisterPushTokenAbortedError>()(
  "RegisterPushTokenAbortedError",
  { message: Schema.String },
) {}

export type RegisterPushTokenExecutionError =
  | RegisterPushTokenAbortedError
  | RegisterPushTokenPermanentError
  | RegisterPushTokenRetryableError;

type RegistrationEffect<A> = Effect.Effect<A, PushRegistrationStorageError>;
export type PushRegistrationServiceApi = {
  /** Retire the current identity until a different auth scope is observed. */
  readonly clear: () => RegistrationEffect<void>;
  /** Restore registration if local Firebase sign-out failed. */
  readonly resume: () => Effect.Effect<void>;
  /** Resume accepted work, retaining its deadline and authentication scope. */
  readonly sync: () => RegistrationEffect<PushRegistrationResult>;
  /** Persist the latest desired registration before attempting durable delivery. */
  readonly register: (
    input: PushRegistrationInput,
  ) => RegistrationEffect<PushRegistrationResult>;
};

export class PushRegistrationService extends Context.Service<
  PushRegistrationService,
  PushRegistrationServiceApi
>()("@hccnj/mobile/PushRegistrationService") {}

export type PushRegistrationServiceDependencies = {
  readonly storage: PushRegistrationStorage;
  readonly getCurrentAuthScope: () => string;
  readonly getCurrentUid: () => string | undefined;
  readonly getConnectivityStatus: () => ConnectivityStatus;
  readonly getRetryDelayMs: (attempt: number) => number;
  readonly isDurableSyncEnabled: () => boolean;
  readonly isRegistrationConfirmed: (
    input: PushRegistrationInput,
    uid: string,
  ) => boolean;
  readonly confirmRegistration: (
    registration: PushRegistration,
    uid: string,
    receipt: PushSubscriptionReceipt,
  ) => void;
  readonly executeRegistration: (
    registration: PushRegistration,
    signal: AbortSignal,
  ) => Effect.Effect<PushSubscriptionReceipt, RegisterPushTokenExecutionError>;
};

const pendingCount = Metric.gauge("offline_mutation_outbox_depth", {
  description: "Current durable offline mutation outbox depth",
});
const pendingAge = Metric.histogram("offline_mutation_outbox_oldest_age_ms", {
  description: "Age of the oldest durable offline mutation",
  boundaries: Metric.exponentialBoundaries({
    start: 1_000,
    factor: 2,
    count: 20,
  }),
});
const outcomes = Metric.counter("offline_mutation_outbox_outcome_total", {
  description: "Durable offline mutation outcomes",
  incremental: true,
});
const recordOutcome = (outcome: string) =>
  Metric.update(
    Metric.withAttributes(outcomes, { command: "registerPushToken", outcome }),
    1,
  );

function sameRegistration(
  current: PushRegistration,
  next: PushRegistration,
): boolean {
  return (
    current.authScope === next.authScope &&
    current.token === next.token &&
    current.platform === next.platform &&
    pushSubscriptionsKey(current.subscriptions) ===
      pushSubscriptionsKey(next.subscriptions)
  );
}

export const makePushRegistrationService = Effect.fn(
  "PushRegistrationService.make",
)(function* (
  dependencies: PushRegistrationServiceDependencies,
): Effect.fn.Return<PushRegistrationServiceApi, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const worker = yield* Semaphore.make(1);
  let retryFiber: Fiber.Fiber<void> | undefined;
  let activeController: AbortController | undefined;
  let generation = 0;
  let closed = false;
  let retiredScope: string | undefined;
  let storageRetry: { attempt: number; retryAtMs: number } | undefined;

  const isCurrentIdentity = (
    uid: string | undefined,
    authScope: string,
  ): uid is string => {
    const currentScope = dependencies.getCurrentAuthScope();
    if (retiredScope !== currentScope) {
      retiredScope = undefined;
    }
    return (
      uid !== undefined &&
      dependencies.getCurrentUid() === uid &&
      currentScope === authScope &&
      retiredScope !== authScope
    );
  };

  const storageOperation = <A>(
    operation: "read" | "remove" | "write",
    run: () => A,
  ) =>
    Effect.try({
      try: run,
      catch: (cause) =>
        new PushRegistrationStorageError({
          operation,
          cause,
          message: `Failed to ${operation} the offline mutation outbox`,
        }),
    });
  const read = Effect.fn("PushRegistrationService.read")(function* () {
    const result = yield* storageOperation("read", dependencies.storage.read);
    if (result.status === "discarded") {
      yield* recordOutcome("discarded_invalid");
    }
    const registration =
      result.status === "pending" ? result.registration : null;
    yield* Metric.update(pendingCount, registration ? 1 : 0);
    return registration;
  });
  const write = Effect.fn("PushRegistrationService.write")(function* (
    registration: PendingPushRegistration,
  ) {
    yield* storageOperation("write", () => {
      dependencies.storage.write(registration);
    });
    yield* Metric.update(pendingCount, 1);
  });
  const remove = Effect.fn("PushRegistrationService.remove")(function* () {
    yield* storageOperation("remove", dependencies.storage.clear);
    yield* Metric.update(pendingCount, 0);
  });
  const cancelRetry = Effect.fn("PushRegistrationService.cancelRetry")(
    function* () {
      const previous = retryFiber;
      retryFiber = undefined;
      if (previous) {
        yield* Fiber.interrupt(previous);
      }
    },
  );
  const invalidate = () => {
    generation += 1;
    activeController?.abort();
  };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      invalidate();
    }),
  );

  const discard = Effect.fn("PushRegistrationService.discard")(function* () {
    invalidate();
    storageRetry = undefined;
    yield* remove().pipe(Effect.ensuring(cancelRetry()));
  });
  const clear = Effect.fn("PushRegistrationService.clear")(function* () {
    retiredScope = dependencies.getCurrentAuthScope();
    yield* discard();
    yield* recordOutcome("cleared");
  });

  let sync: PushRegistrationServiceApi["sync"];
  const scheduleRetry = Effect.fn("PushRegistrationService.scheduleRetry")(
    function* (retryAtMs: number) {
      if (retryFiber || closed) {
        return;
      }
      const now = yield* Clock.currentTimeMillis;
      retryFiber = yield* Effect.sleep(Math.max(0, retryAtMs - now)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            retryFiber = undefined;
          }),
        ),
        Effect.andThen(Effect.suspend(() => sync())),
        Effect.catchTag("OfflineMutationOutboxStorageError", (error) =>
          Effect.logError("Push registration retry could not access storage", {
            operation: error.operation,
          }),
        ),
        Effect.asVoid,
        Effect.forkIn(scope),
      );
    },
  );

  // Both rollout modes use this one request/confirmation path. Only durable
  // registrations survive failure and schedule another attempt.
  const attempt = Effect.fn("PushRegistrationService.attempt")(function* (
    registration: PendingPushRegistration,
    durable: boolean,
  ): Effect.fn.Return<PushRegistrationResult, PushRegistrationStorageError> {
    const expectedGeneration = generation;
    const uid = dependencies.getCurrentUid();
    if (closed || !isCurrentIdentity(uid, registration.authScope)) {
      return { status: "ignored" };
    }
    const controller = new AbortController();
    activeController = controller;
    const execution = yield* dependencies
      .executeRegistration(registration, controller.signal)
      .pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            controller.abort();
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (activeController === controller) {
              activeController = undefined;
            }
          }),
        ),
        Effect.exit,
      );

    if (closed || generation !== expectedGeneration) {
      return { status: "ignored" };
    }
    if (!isCurrentIdentity(uid, registration.authScope)) {
      if (durable) {
        yield* remove();
        yield* recordOutcome("discarded_scope_mismatch");
      }
      return { status: "ignored" };
    }
    if (durable) {
      const current = yield* read();
      if (
        !current ||
        !sameRegistration(current, registration) ||
        current.requestedAtMs !== registration.requestedAtMs
      ) {
        return { status: "ignored" };
      }
    }

    if (Exit.isSuccess(execution)) {
      yield* storageOperation("write", () => {
        dependencies.confirmRegistration(registration, uid, execution.value);
      });
      if (durable) {
        yield* remove();
      }
      yield* recordOutcome(durable ? "success" : "online_fallback_success");
      return { status: "confirmed" };
    }
    if (!durable) {
      yield* recordOutcome("online_fallback_failure");
      return { status: "failed" };
    }
    const failure = Option.getOrUndefined(
      Cause.findErrorOption(execution.cause),
    );
    const aborted =
      controller.signal.aborted ||
      Schema.is(RegisterPushTokenAbortedError)(failure);
    if (Schema.is(RegisterPushTokenPermanentError)(failure)) {
      yield* write({ ...registration, state: "failed" });
      yield* recordOutcome("permanent_failure");
      return { status: "failed" };
    }
    const nextAttempt = registration.attempt + 1;
    const delay = Schema.is(RegisterPushTokenRetryableError)(failure)
      ? (failure.retryAfterMs ?? dependencies.getRetryDelayMs(nextAttempt))
      : dependencies.getRetryDelayMs(nextAttempt);
    const retryAtMs = (yield* Clock.currentTimeMillis) + delay;
    yield* write({
      ...registration,
      attempt: nextAttempt,
      nextAttemptAtMs: retryAtMs,
    });
    yield* recordOutcome(aborted ? "aborted" : "retryable_failure");
    yield* scheduleRetry(retryAtMs);
    return { status: "queued", retryAtMs };
  });

  const syncPending = Effect.fn("PushRegistrationService.syncPending")(
    function* (
      known?: PendingPushRegistration | null,
    ): Effect.fn.Return<PushRegistrationResult, PushRegistrationStorageError> {
      const uid = dependencies.getCurrentUid();
      const authScope = dependencies.getCurrentAuthScope();
      const expectedGeneration = generation;
      if (closed || !isCurrentIdentity(uid, authScope)) {
        return { status: "ignored" };
      }
      const now = yield* Clock.currentTimeMillis;
      if (storageRetry && storageRetry.retryAtMs > now) {
        yield* scheduleRetry(storageRetry.retryAtMs);
        return { status: "queued", retryAtMs: storageRetry.retryAtMs };
      }
      const result = yield* Effect.gen(function* (): Effect.fn.Return<
        PushRegistrationResult,
        PushRegistrationStorageError
      > {
        const registration = known === undefined ? yield* read() : known;
        if (!registration) {
          return { status: "unchanged" };
        }
        if (!isCurrentIdentity(uid, registration.authScope)) {
          yield* discard();
          yield* recordOutcome("discarded_scope_mismatch");
          return { status: "ignored" };
        }
        if (registration.state === "failed") {
          return { status: "failed" };
        }
        yield* Metric.update(
          pendingAge,
          Math.max(0, now - registration.requestedAtMs),
        );
        if (dependencies.getConnectivityStatus() === "offline") {
          return { status: "queued" };
        }
        if (registration.nextAttemptAtMs > now) {
          yield* scheduleRetry(registration.nextAttemptAtMs);
          return { status: "queued", retryAtMs: registration.nextAttemptAtMs };
        }
        yield* cancelRetry();
        if (generation !== expectedGeneration) {
          return { status: "ignored" };
        }
        return yield* attempt(registration, true);
      }).pipe(
        Effect.catchTag("OfflineMutationOutboxStorageError", (error) =>
          Effect.gen(function* () {
            // Storage may be unavailable, so retain this recovery deadline in memory.
            // The accepted registration stays on disk and is re-read on every retry.
            if (
              !closed &&
              generation === expectedGeneration &&
              isCurrentIdentity(uid, authScope)
            ) {
              const attempt = (storageRetry?.attempt ?? 0) + 1;
              const retryAtMs =
                (yield* Clock.currentTimeMillis) +
                dependencies.getRetryDelayMs(attempt);
              storageRetry = { attempt, retryAtMs };
              yield* cancelRetry();
              if (
                !closed &&
                generation === expectedGeneration &&
                isCurrentIdentity(uid, authScope)
              ) {
                yield* scheduleRetry(retryAtMs);
              }
            }
            return yield* error;
          }),
        ),
      );
      storageRetry = undefined;
      return result;
    },
  );
  sync = () => worker.withPermit(syncPending());

  const register = Effect.fn("PushRegistrationService.register")(
    function* (
      input: PushRegistrationInput,
    ): Effect.fn.Return<PushRegistrationResult, PushRegistrationStorageError> {
      const uid = dependencies.getCurrentUid();
      const authScope = dependencies.getCurrentAuthScope();
      const token = input.token.trim();
      if (closed || !token || !isCurrentIdentity(uid, authScope)) {
        return { status: "ignored" };
      }
      const desired: PushRegistration = {
        ...input,
        token,
        authScope,
        subscriptions: normalizePushSubscriptions(input.subscriptions),
      };
      let pending = yield* read();
      if (pending && pending.authScope !== authScope) {
        yield* discard();
        pending = null;
      }
      if (dependencies.isRegistrationConfirmed(desired, uid)) {
        if (pending) {
          yield* discard();
        }
        return { status: "unchanged" };
      }

      const durable = dependencies.isDurableSyncEnabled();
      if (!durable && pending) {
        const result =
          pending.state === "failed"
            ? { status: "failed" as const }
            : yield* syncPending(pending);
        if (result.status === "queued") {
          return result;
        }
        if (closed || !isCurrentIdentity(uid, authScope)) {
          return { status: "ignored" };
        }
        if (result.status === "failed") {
          if (
            pending.state !== "failed" &&
            sameRegistration(pending, desired)
          ) {
            return result;
          }
          yield* discard();
        }
        if (dependencies.isRegistrationConfirmed(desired, uid)) {
          return { status: "unchanged" };
        }
        pending = null;
      }
      if (closed || !isCurrentIdentity(uid, authScope)) {
        return { status: "ignored" };
      }
      if (!durable && dependencies.getConnectivityStatus() === "offline") {
        return { status: "ignored" };
      }

      const now = yield* Clock.currentTimeMillis;
      const next: PendingPushRegistration = {
        ...desired,
        requestedAtMs: now,
        attempt: 0,
        nextAttemptAtMs: now,
        state: "pending",
      };
      if (!durable) {
        return yield* attempt(next, false);
      }
      if (
        !pending ||
        pending.state === "failed" ||
        !sameRegistration(pending, desired)
      ) {
        const expectedGeneration = generation;
        yield* cancelRetry();
        if (
          generation !== expectedGeneration ||
          closed ||
          !isCurrentIdentity(uid, authScope)
        ) {
          return { status: "ignored" };
        }
        yield* write(next);
        storageRetry = undefined;
        yield* recordOutcome(pending ? "coalesced" : "enqueued");
        pending = next;
      }
      return yield* syncPending(pending);
    },
    (effect) => worker.withPermit(effect),
  );

  const resume = () =>
    Effect.sync(() => {
      retiredScope = undefined;
    });
  return { clear, resume, sync, register };
});

export const clearPushRegistration = Effect.fn(
  "PushRegistrationService.access.clear",
)(function* () {
  return yield* (yield* PushRegistrationService).clear();
});
export const syncPushRegistration = Effect.fn(
  "PushRegistrationService.access.sync",
)(function* () {
  return yield* (yield* PushRegistrationService).sync();
});
export const registerPushToken = Effect.fn(
  "PushRegistrationService.access.register",
)(function* (input: PushRegistrationInput) {
  return yield* (yield* PushRegistrationService).register(input);
});

export const resumePushRegistration = Effect.fn(
  "PushRegistrationService.access.resume",
)(function* () {
  yield* (yield* PushRegistrationService).resume();
});
