import { Predicate, Effect } from "effect";
import { commitMutation, graphql } from "react-relay";
import type { Disposable } from "relay-runtime";

import {
  RegisterPushTokenAbortedError,
  RegisterPushTokenPermanentError,
  RegisterPushTokenRetryableError,
  REGISTER_PUSH_TOKEN_TIMEOUT_MS,
} from "@/effect/pushRegistrationService";
import { getEnvironmentState } from "@/utils/getDefaultRelayStore";
import { pushLogoutStore } from "@/utils/pushLogout";
import type { PushRegistration } from "@/utils/pushRegistrationStorage";
import type { PushSubscriptionReceipt } from "@/utils/pushSubscriptions";
import {
  pushSubscriptionInput,
  confirmPushSubscriptions,
} from "@/utils/pushSubscriptions";
import {
  getPushTokenRegistrationUid,
  getPushTokenRegistrationScope,
  getPushTokenRelayScope,
} from "@/utils/pushTokenAuth";

import type { PushTokensRegisterPushTokenMutation } from "./__generated__/PushTokensRegisterPushTokenMutation.graphql";

// Operation name must stay PushTokensRegisterPushTokenMutation — it is in the
// backend's known-operation-names metrics allowlist.
const RegisterPushTokenMutation = graphql`
  mutation PushTokensRegisterPushTokenMutation(
    $input: RegisterPushTokenInput!
  ) {
    registerPushToken(input: $input) {
      message
      success
      topics
      campusSlug
      campusPreferenceVersion
      retryable
    }
  }
`;

type GraphQLMutationError = {
  readonly extensions?: { readonly code?: string };
  readonly message?: string;
};

const MAX_CAUSE_DEPTH = 8;

function getHttpStatus(cause: unknown, depth = 0): number | undefined {
  if (!Predicate.isObjectOrArray(cause) || depth >= MAX_CAUSE_DEPTH) {
    return undefined;
  }

  if ("status" in cause && Predicate.isNumber(cause.status)) {
    return cause.status;
  }

  return "cause" in cause ? getHttpStatus(cause.cause, depth + 1) : undefined;
}

function getRetryAfterMs(cause: unknown, depth = 0): number | undefined {
  if (!Predicate.isObjectOrArray(cause) || depth >= MAX_CAUSE_DEPTH) {
    return undefined;
  }

  if (
    "retryAfterMs" in cause &&
    Predicate.isNumber(cause.retryAfterMs) &&
    cause.retryAfterMs >= 0
  ) {
    return cause.retryAfterMs;
  }

  return "cause" in cause ? getRetryAfterMs(cause.cause, depth + 1) : undefined;
}

function isCancellationError(cause: unknown, depth = 0): boolean {
  if (!Predicate.isObjectOrArray(cause) || depth >= MAX_CAUSE_DEPTH) {
    return false;
  }

  const name = "name" in cause ? cause.name : undefined;
  const message = "message" in cause ? cause.message : undefined;
  if (
    name === "AbortError" ||
    name === "FetchRequestCanceledException" ||
    (Predicate.isString(message) &&
      /FetchRequestCanceledException|fetch request (?:has been |was )?cancel(?:l)?ed/i.test(
        message,
      ))
  ) {
    return true;
  }

  return "cause" in cause && isCancellationError(cause.cause, depth + 1);
}

function retryableError(cause: unknown, message: string) {
  return new RegisterPushTokenRetryableError({ message, cause });
}

function classifyNetworkError(cause: unknown) {
  if (isCancellationError(cause)) {
    return new RegisterPushTokenAbortedError({
      message: "Push token registration was canceled",
    });
  }

  const status = getHttpStatus(cause);
  if (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  ) {
    return new RegisterPushTokenPermanentError({
      message: `Push token registration was rejected with HTTP ${status}`,
      cause,
    });
  }

  return new RegisterPushTokenRetryableError({
    message: "Push token registration request failed",
    retryAfterMs: getRetryAfterMs(cause),
    cause,
  });
}

function classifyGraphQLErrors(errors: readonly GraphQLMutationError[]) {
  const codes = errors.map((error) => error.extensions?.code);
  const isPermanent = codes.some(
    (code) =>
      code === "BAD_USER_INPUT" ||
      code === "FORBIDDEN" ||
      code === "GRAPHQL_VALIDATION_FAILED",
  );

  return isPermanent
    ? new RegisterPushTokenPermanentError({
        message: "Push token registration was rejected by GraphQL",
      })
    : new RegisterPushTokenRetryableError({
        message: "Push token registration returned GraphQL errors",
      });
}

export const executeRegisterPushTokenMutation = Effect.fn(
  "executeRegisterPushTokenMutation",
)(function* (registration: PushRegistration, signal: AbortSignal) {
  return yield* Effect.callback<
    PushSubscriptionReceipt,
    | RegisterPushTokenAbortedError
    | RegisterPushTokenPermanentError
    | RegisterPushTokenRetryableError
  >((resume) => {
    let disposable: Disposable | undefined;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    };
    const settle = (
      effect: Effect.Effect<
        PushSubscriptionReceipt,
        | RegisterPushTokenAbortedError
        | RegisterPushTokenPermanentError
        | RegisterPushTokenRetryableError
      >,
    ) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resume(effect);
    };
    const abort = () => {
      disposable?.dispose();
      settle(
        Effect.fail(
          new RegisterPushTokenAbortedError({
            message: "Push token registration was canceled",
          }),
        ),
      );
    };
    const timeout = setTimeout(() => {
      disposable?.dispose();
      settle(
        Effect.fail(
          new RegisterPushTokenRetryableError({
            message: "Push token registration timed out",
          }),
        ),
      );
    }, REGISTER_PUSH_TOKEN_TIMEOUT_MS);

    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return Effect.void;
    }

    const environmentState = getEnvironmentState();
    if (
      getPushTokenRegistrationScope() !== registration.authScope ||
      environmentState?.authScope !== getPushTokenRelayScope()
    ) {
      settle(
        Effect.fail(
          retryableError(
            undefined,
            "Relay environment does not match the queued authentication scope",
          ),
        ),
      );
      return Effect.void;
    }

    try {
      disposable = commitMutation<PushTokensRegisterPushTokenMutation>(
        environmentState.environment,
        {
          mutation: RegisterPushTokenMutation,
          variables: {
            input: {
              token: registration.token,
              logoutKey: pushLogoutStore.keyFor(
                registration.token,
                getPushTokenRegistrationUid() ?? "",
              ),
              ...pushSubscriptionInput(registration.subscriptions),
              platform: registration.platform,
            },
          },
          onCompleted: (response, errors) => {
            if (errors?.length) {
              settle(
                Effect.fail(
                  classifyGraphQLErrors(
                    errors as readonly GraphQLMutationError[],
                  ),
                ),
              );
              return;
            }

            const result = response?.registerPushToken;
            if (!result?.success) {
              settle(
                Effect.fail(
                  result?.retryable
                    ? new RegisterPushTokenRetryableError({
                        message: result.message,
                      })
                    : new RegisterPushTokenPermanentError({
                        message:
                          result?.message ??
                          "Push token registration was rejected",
                      }),
                ),
              );
              return;
            }

            const receipt = confirmPushSubscriptions(
              registration.subscriptions,
              result,
            );
            if (!receipt) {
              settle(
                Effect.fail(
                  retryableError(
                    undefined,
                    "Push subscriptions were not confirmed",
                  ),
                ),
              );
              return;
            }
            settle(Effect.succeed(receipt));
          },
          onError: (cause) => {
            settle(Effect.fail(classifyNetworkError(cause)));
          },
        },
      );
    } catch (cause) {
      settle(Effect.fail(classifyNetworkError(cause)));
    }

    return Effect.sync(() => {
      cleanup();
      disposable?.dispose();
    });
  });
});
