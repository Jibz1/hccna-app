import {
  Predicate,
  Clock,
  Context,
  Effect,
  Exit,
  Schedule,
  Schema,
} from "effect";
import type {
  CacheConfig,
  GraphQLResponse,
  RequestParameters,
  Variables,
} from "relay-runtime";

import {
  GraphQLHttpResponseError,
  GraphQLNotModifiedWithoutPayloadError,
  GraphQLParseError,
  GraphQLRequestError,
  GraphQLUnsupportedContentTypeError,
} from "@/effect/errors";
import type { GraphQLRequestTelemetry } from "@/effect/graphqlTelemetryService";
import { resolveTrustedAppsBackendUrl } from "@/utils/backendUrl";

type FirebaseAuthUser = {
  readonly uid?: string | null;
};

type FirebaseAuthClient = {
  readonly currentUser: FirebaseAuthUser | null;
};

type SignInResult = {
  readonly user: FirebaseAuthUser;
};

type FetchRequest = {
  readonly signal: AbortSignal;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
};

type FetchGraphQL = (url: string, request: FetchRequest) => Promise<Response>;

type MultipartParser = (response: Response) => AsyncIterable<any>;

export type GraphQLNetworkError =
  | GraphQLHttpResponseError
  | GraphQLNotModifiedWithoutPayloadError
  | GraphQLParseError
  | GraphQLRequestError
  | GraphQLUnsupportedContentTypeError;

type GraphQLNetworkEffect<A> = Effect.Effect<A, GraphQLNetworkError>;

export type GraphQLNetworkSink = {
  readonly next: (response: GraphQLResponse) => void;
};

export type GraphQLNetworkRequest = {
  readonly operation: RequestParameters;
  readonly variables: Variables;
  readonly cacheConfig?: CacheConfig | null;
  readonly signal: AbortSignal;
  readonly sink: GraphQLNetworkSink;
};

export type GraphQLNetworkServiceApi = {
  readonly ensureClientIdentity: () => Effect.Effect<void, GraphQLRequestError>;
  readonly execute: (
    request: GraphQLNetworkRequest,
  ) => GraphQLNetworkEffect<void>;
};

export type GraphQLNetworkServiceDependencies = {
  readonly defaultBackendUrl: string;
  readonly legacyApiToken?: string;
  readonly getTelemetryHeaders: () => Promise<Record<string, string>>;
  readonly getAuth: () => FirebaseAuthClient;
  readonly getIdToken: (user: FirebaseAuthUser) => Promise<string>;
  readonly signInAnonymously: (
    auth: FirebaseAuthClient,
  ) => Promise<SignInResult>;
  readonly isStatsigReady: () => Effect.Effect<boolean>;
  readonly getStatsigBackendEndpoint: () => Effect.Effect<string | null>;
  readonly recordTelemetry: (
    telemetry: GraphQLRequestTelemetry,
  ) => Effect.Effect<void>;
  readonly fetch: FetchGraphQL;
  readonly parseMultipart: MultipartParser;
};

export class GraphQLNetworkService extends Context.Service<
  GraphQLNetworkService,
  GraphQLNetworkServiceApi
>()("GraphQLNetworkService") {}

// expo/fetch sends every request without a URLSession timeout, so a request on
// a stalled connection never settles and Suspense never leaves its fallback.
// The server answers or gives up within 20s; its slowest observed reply is 5s.
export const GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS = 15_000;

const operationNameOf = (operation: RequestParameters) =>
  operation.name ?? operation.id ?? "GraphQLRequest";

const getUnknownMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

const isAbortError = (cause: unknown) =>
  cause instanceof Error && cause.name === "AbortError";

function isTransientRequestError(error: GraphQLNetworkError): boolean {
  if (error._tag !== "GraphQLRequestError") {
    return false;
  }

  const cause = error.cause;
  return (
    cause instanceof TypeError ||
    (cause instanceof Error &&
      (cause.name === "TimeoutError" ||
        // Expo's FetchError extends Error and prefixes native transport failures.
        cause.message.startsWith("fetch failed:"))) ||
    (Predicate.hasProperty(cause, "code") &&
      cause.code === "auth/network-request-failed")
  );
}

function parseRetryAfterMs(
  value: string | null | undefined,
  currentTimeMs: number,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(0, dateMs - currentTimeMs);
}

const JsonString = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeUnknownSync(JsonString);

function isGraphQLSingularResponse(
  value: unknown,
): value is Exclude<GraphQLResponse, readonly unknown[]> {
  if (!Predicate.isObjectOrArray(value) || Array.isArray(value)) {
    return false;
  }

  if ("data" in value) {
    return true;
  }

  return (
    "errors" in value && Array.isArray(value.errors) && value.errors.length > 0
  );
}

function isGraphQLResponse(value: unknown): value is GraphQLResponse {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isGraphQLSingularResponse);
  }

  return isGraphQLSingularResponse(value);
}

const getHttpErrorMessage = (response: Response) =>
  `GraphQL request failed with HTTP ${response.status}${
    response.statusText ? ` ${response.statusText}` : ""
  }`;

function getUtf8ByteLength(value: string): number {
  let byteLength = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    byteLength +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }

  return byteLength;
}

function getContentLength(response: Response): number | undefined {
  const header = response.headers?.get("content-length");
  if (!header) {
    return undefined;
  }

  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

type GraphQLRequestTelemetryState = {
  aborted: boolean;
  responseBytes?: number;
  statusCode?: number;
  timedOut: boolean;
};

export function makeGraphQLNetworkService(
  dependencies: GraphQLNetworkServiceDependencies,
): GraphQLNetworkServiceApi {
  const getAuthorizationToken = Effect.fn(
    "GraphQLNetworkService.getAuthorizationToken",
  )(function* () {
    const auth = dependencies.getAuth();

    if (auth.currentUser) {
      // A token failure must not replace an existing session with anonymous auth.
      return yield* Effect.tryPromise({
        try: () =>
          dependencies.getIdToken(auth.currentUser as FirebaseAuthUser),
        catch: (cause) =>
          new GraphQLRequestError({
            operationName: "AuthorizationToken",
            message: getUnknownMessage(
              cause,
              "Failed to get current Firebase auth token",
            ),
            cause,
          }),
      });
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const anonymousUser = (await dependencies.signInAnonymously(auth)).user;
        return await dependencies.getIdToken(anonymousUser);
      },
      catch: (cause) =>
        new GraphQLRequestError({
          operationName: "AuthorizationToken",
          message: getUnknownMessage(cause, "Anonymous Firebase auth failed"),
          cause,
        }),
    }).pipe(
      Effect.catchTag("GraphQLRequestError", (error) =>
        Effect.log(
          "Anonymous Firebase auth failed, falling back to legacy API token",
          { message: error.message },
        ).pipe(Effect.as(dependencies.legacyApiToken ?? null)),
      ),
    );
  });

  const getAppsBackendUrl = Effect.fn(
    "GraphQLNetworkService.getAppsBackendUrl",
  )(function* () {
    const result = yield* Effect.exit(
      Effect.gen(function* () {
        if (!(yield* dependencies.isStatsigReady())) {
          return dependencies.defaultBackendUrl;
        }

        const configuredEndpoint =
          yield* dependencies.getStatsigBackendEndpoint();
        if (!configuredEndpoint) {
          return dependencies.defaultBackendUrl;
        }

        const trustedEndpoint =
          resolveTrustedAppsBackendUrl(configuredEndpoint);
        if (!trustedEndpoint) {
          yield* Effect.logWarning(
            "Ignoring untrusted GraphQL backend endpoint from remote config",
          );
          return dependencies.defaultBackendUrl;
        }

        return trustedEndpoint;
      }),
    );

    if (Exit.isSuccess(result)) {
      return result.value;
    }

    yield* Effect.log(
      "Failed to load backend endpoint from Statsig, using default endpoint",
    );
    return dependencies.defaultBackendUrl;
  });

  const getRequestTelemetryHeaders = Effect.fn(
    "GraphQLNetworkService.getRequestTelemetryHeaders",
  )(function* (operationName: string) {
    return yield* Effect.tryPromise({
      try: () => dependencies.getTelemetryHeaders(),
      catch: (cause) =>
        new GraphQLRequestError({
          operationName,
          message: getUnknownMessage(
            cause,
            "Failed to load GraphQL telemetry headers",
          ),
          cause,
        }),
    }).pipe(
      Effect.catchTag("GraphQLRequestError", (error) =>
        Effect.log("Failed to load GraphQL telemetry headers", {
          message: error.message,
        }).pipe(Effect.as({})),
      ),
    );
  });

  const parseJsonResponse = Effect.fn(
    "GraphQLNetworkService.parseJsonResponse",
  )(function* (
    operationName: string,
    response: Response,
    telemetry: GraphQLRequestTelemetryState,
  ) {
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new GraphQLParseError({
          operationName,
          message: getUnknownMessage(cause, "Failed to read GraphQL JSON"),
          cause,
        }),
    });
    telemetry.responseBytes ??= getUtf8ByteLength(body);

    return yield* Effect.try({
      try: () => JSON.parse(body) as unknown,
      catch: (cause) =>
        new GraphQLParseError({
          operationName,
          message: getUnknownMessage(cause, "Failed to parse GraphQL JSON"),
          cause,
        }),
    });
  });

  const parseMultipartResponse = Effect.fn(
    "GraphQLNetworkService.parseMultipartResponse",
  )(function* (
    operationName: string,
    response: Response,
    sink: GraphQLNetworkSink,
  ) {
    return yield* Effect.tryPromise({
      try: async () => {
        const iterator = dependencies.parseMultipart(response);

        for await (const chunk of iterator) {
          if ("items" in chunk && chunk.items) {
            for (const item of chunk.items) {
              sink.next({ ...chunk, data: item });
            }
          }

          if ("data" in chunk && chunk.data) {
            sink.next(chunk);
          }

          if ("errors" in chunk && chunk.errors) {
            sink.next(chunk);
          }
        }
      },
      catch: (cause) =>
        new GraphQLParseError({
          operationName,
          message: getUnknownMessage(
            cause,
            "Failed to parse GraphQL multipart response",
          ),
          cause,
        }),
    });
  });

  const executeRequest = Effect.fnUntraced(function* (
    { operation, variables, cacheConfig, signal, sink }: GraphQLNetworkRequest,
    telemetry: GraphQLRequestTelemetryState,
  ) {
    if (signal.aborted) {
      telemetry.aborted = true;
      return;
    }
    const operationName = operationNameOf(operation);
    const [token, appsBackendUrl, telemetryHeaders] = yield* Effect.all(
      [
        getAuthorizationToken(),
        getAppsBackendUrl(),
        getRequestTelemetryHeaders(operationName),
      ],
      { concurrency: "unbounded" },
    );
    if (signal.aborted) {
      telemetry.aborted = true;
      return;
    }
    const headers = { ...telemetryHeaders };
    headers["content-type"] ??= "application/json";

    if (cacheConfig?.force) {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      headers.Pragma = "no-cache";
    }

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        dependencies.fetch(`${appsBackendUrl}/graphql`, {
          signal,
          method: "POST",
          headers,
          body: encodeJson({
            id: operation.id,
            query: operation.text,
            variables,
          }),
        }),
      catch: (cause) =>
        new GraphQLRequestError({
          operationName,
          message: getUnknownMessage(cause, "GraphQL request failed"),
          cause,
        }),
    }).pipe(
      Effect.catchTag("GraphQLRequestError", (error) =>
        signal.aborted || isAbortError(error.cause)
          ? Effect.succeed(null)
          : Effect.fail(error),
      ),
    );

    if (!response) {
      telemetry.aborted = true;
      return;
    }

    telemetry.statusCode = response.status;
    telemetry.responseBytes = getContentLength(response);
    const retryAfterHeader = response.headers?.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? parseRetryAfterMs(retryAfterHeader, yield* Clock.currentTimeMillis)
      : undefined;

    if (response.status === 304) {
      return yield* new GraphQLNotModifiedWithoutPayloadError({
        operationName,
        status: response.status,
        message:
          "Received HTTP 304 without a GraphQL response payload; conditional GraphQL requests are unsupported",
      });
    }

    const contentType = response.headers?.get("content-type");
    if (contentType?.includes("application/json")) {
      const result = yield* parseJsonResponse(
        operationName,
        response,
        telemetry,
      );

      if (!isGraphQLResponse(result)) {
        if (!response.ok) {
          return yield* new GraphQLHttpResponseError({
            operationName,
            status: response.status,
            retryAfterMs,
            message: getHttpErrorMessage(response),
            result,
          });
        }

        return yield* new GraphQLParseError({
          operationName,
          message: "GraphQL JSON response did not contain data or errors",
        });
      }

      if (!response.ok) {
        return yield* new GraphQLHttpResponseError({
          operationName,
          status: response.status,
          retryAfterMs,
          message: getHttpErrorMessage(response),
          result,
        });
      }

      sink.next(result);
      return;
    }

    if (!response.ok) {
      return yield* new GraphQLHttpResponseError({
        operationName,
        status: response.status,
        retryAfterMs,
        message: getHttpErrorMessage(response),
      });
    }

    if (contentType?.includes("multipart/mixed")) {
      return yield* parseMultipartResponse(operationName, response, sink);
    }

    return yield* new GraphQLUnsupportedContentTypeError({
      operationName,
      contentType: contentType ?? undefined,
      message: `Unsupported content type: "${contentType}"`,
    });
  });

  // Each attempt gets its own abort so a timed-out attempt cancels its native
  // request (and its body read) without aborting Relay's signal for the retry.
  const executeAttempt = (
    request: GraphQLNetworkRequest,
    telemetry: GraphQLRequestTelemetryState,
  ) =>
    Effect.suspend(() => {
      const attempt = new AbortController();
      const abortAttempt = () => {
        attempt.abort();
      };
      if (request.signal.aborted) {
        abortAttempt();
      }
      request.signal.addEventListener("abort", abortAttempt);
      telemetry.timedOut = false;

      return executeRequest(
        { ...request, signal: attempt.signal },
        telemetry,
      ).pipe(
        Effect.onInterrupt(() => Effect.sync(abortAttempt)),
        Effect.timeout(GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS),
        Effect.catchTag("TimeoutError", (cause) =>
          Effect.suspend(() => {
            telemetry.timedOut = true;
            return Effect.fail(
              new GraphQLRequestError({
                operationName: operationNameOf(request.operation),
                message: `GraphQL request timed out after ${GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS}ms`,
                cause,
              }),
            );
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            request.signal.removeEventListener("abort", abortAttempt);
          }),
        ),
      );
    });

  const recordTelemetryOnExit = Effect.fnUntraced(function* (
    operationName: string,
    startedAt: number,
    telemetry: GraphQLRequestTelemetryState,
    exit: Exit.Exit<void, GraphQLNetworkError>,
  ) {
    const completedAt = yield* Clock.currentTimeMillis;
    const outcome = telemetry.aborted
      ? "aborted"
      : Exit.isSuccess(exit)
        ? "success"
        : telemetry.timedOut
          ? "timeout"
          : "error";

    yield* dependencies.recordTelemetry({
      operationName,
      outcome,
      durationMs: Math.max(0, completedAt - startedAt),
      statusCode: telemetry.statusCode,
      responseBytes: telemetry.responseBytes,
    });
  });

  const execute = Effect.fn("GraphQLNetworkService.execute")(function* (
    request: GraphQLNetworkRequest,
  ) {
    const startedAt = yield* Clock.currentTimeMillis;
    const telemetry: GraphQLRequestTelemetryState = {
      aborted: false,
      timedOut: false,
    };

    return yield* executeAttempt(request, telemetry).pipe(
      // Phone startup and network handoffs can briefly fail fetch/token refresh.
      // Only retry reads before a response; replaying mutations can duplicate writes.
      Effect.retry({
        times: 2,
        schedule: Schedule.exponential("1 second"),
        while: (error) =>
          request.operation.operationKind === "query" &&
          !request.signal.aborted &&
          isTransientRequestError(error),
      }),
      Effect.onExit((exit) =>
        recordTelemetryOnExit(
          operationNameOf(request.operation),
          startedAt,
          telemetry,
          exit,
        ),
      ),
    );
  });

  const ensureClientIdentity = Effect.fn(
    "GraphQLNetworkService.ensureClientIdentity",
  )(function* () {
    yield* getAuthorizationToken();
    if (!dependencies.getAuth().currentUser) {
      return yield* new GraphQLRequestError({
        operationName: "AuthorizationToken",
        message: "Identity is not ready",
      });
    }
  });
  return { execute, ensureClientIdentity };
}

export const executeGraphQLRequest = Effect.fn(
  "GraphQLNetworkService.access.execute",
)(function* (request: GraphQLNetworkRequest) {
  const service = yield* GraphQLNetworkService;
  return yield* service.execute(request);
});

export const ensureGraphQLClientIdentity = Effect.fn(
  "GraphQLNetworkService.access.ensureClientIdentity",
)(function* () {
  const service = yield* GraphQLNetworkService;
  yield* service.ensureClientIdentity();
});
