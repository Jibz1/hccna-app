import {
  commitMutation,
  useMutation,
  type UseMutationConfig,
} from "react-relay";
import type {
  Environment,
  GraphQLTaggedNode,
  MutationConfig,
  MutationParameters,
} from "relay-runtime";

import {
  assertMutationSucceeded,
  type MutationResultPayload,
} from "./mutationResult";

type CheckedMutationOptions<TMutation extends MutationParameters> = {
  readonly selectResult: (
    response: TMutation["response"],
  ) => MutationResultPayload;
  readonly fallbackMessage: string;
};

/**
 * Our mutations report failure as `{ success: false, message }` in a normal
 * response, so Relay's `onError` never fires. This wrapper rejects in that case.
 */
export function useCheckedMutation<TMutation extends MutationParameters>(
  mutation: GraphQLTaggedNode,
  options: CheckedMutationOptions<TMutation>,
): [
  commit: (
    config: Omit<UseMutationConfig<TMutation>, "onCompleted" | "onError">,
  ) => Promise<TMutation["response"]>,
  isInFlight: boolean,
] {
  const [commit, isInFlight] = useMutation<TMutation>(mutation);

  const commitChecked = (
    config: Omit<UseMutationConfig<TMutation>, "onCompleted" | "onError">,
  ): Promise<TMutation["response"]> =>
    new Promise((resolve, reject) => {
      commit({
        ...config,
        onCompleted: (response, errors) => {
          try {
            assertMutationSucceeded(
              options.selectResult(response),
              errors,
              options.fallbackMessage,
            );
            resolve(response);
          } catch (error) {
            reject(error);
          }
        },
        onError: reject,
      });
    });

  return [commitChecked, isInFlight];
}

export function commitCheckedMutation<TMutation extends MutationParameters>(
  environment: Environment,
  config: Omit<MutationConfig<TMutation>, "onCompleted" | "onError"> &
    CheckedMutationOptions<TMutation>,
): Promise<TMutation["response"]> {
  const { selectResult, fallbackMessage, ...relayConfig } = config;
  return new Promise((resolve, reject) => {
    commitMutation<TMutation>(environment, {
      ...relayConfig,
      onCompleted: (response, errors) => {
        try {
          assertMutationSucceeded(
            selectResult(response),
            errors,
            fallbackMessage,
          );
          resolve(response);
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });
  });
}
