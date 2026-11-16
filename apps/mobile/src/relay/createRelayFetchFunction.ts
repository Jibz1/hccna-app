import { Predicate } from "effect";
import type {
  FetchFunction,
  GraphQLResponse,
  RequestParameters,
  Variables,
} from "relay-runtime";
import { Observable } from "relay-runtime";

import type { GraphQLNetworkRequest } from "@/effect/graphqlNetworkService";

export type GraphQLRequestExecutor = (
  request: GraphQLNetworkRequest,
) => Promise<void>;

function isPartialGraphQLResponse(value: unknown): value is GraphQLResponse {
  if (!Predicate.isObjectOrArray(value) || Array.isArray(value)) {
    return false;
  }

  return (
    "data" in value &&
    value.data != null &&
    "errors" in value &&
    Array.isArray(value.errors) &&
    value.errors.length > 0
  );
}

function getPartialGraphQLResponse(cause: unknown): GraphQLResponse | null {
  if (
    !Predicate.isObjectOrArray(cause) ||
    !("result" in cause) ||
    !isPartialGraphQLResponse(cause.result)
  ) {
    return null;
  }

  return cause.result;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export function createRelayFetchFunction(
  executeRequest: GraphQLRequestExecutor,
): FetchFunction {
  return (
    operation: RequestParameters,
    variables: Variables,
    cacheConfig,
    _uploadables,
  ) =>
    Observable.create((sink) => {
      const controller = new AbortController();

      void Promise.resolve()
        .then(() =>
          executeRequest({
            operation,
            variables,
            cacheConfig,
            signal: controller.signal,
            sink,
          }),
        )
        .then(
          () => {
            sink.complete();
          },
          (cause: unknown) => {
            const partialResponse = getPartialGraphQLResponse(cause);
            if (partialResponse) {
              sink.next(partialResponse);
            }

            sink.error(toError(cause));
          },
        );

      return () => {
        controller.abort();
      };
    });
}
