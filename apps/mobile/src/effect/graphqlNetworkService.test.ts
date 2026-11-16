import { it as effectIt } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { RequestParameters } from "relay-runtime";
import { describe, expect, test, vi } from "vitest";

import {
  executeGraphQLRequest,
  GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS,
  GraphQLNetworkService,
  makeGraphQLNetworkService,
} from "./graphqlNetworkService";
import type { GraphQLNetworkServiceDependencies } from "./graphqlNetworkService";

const operation: RequestParameters = {
  cacheID: "query-id",
  id: null,
  operationKind: "query",
  name: "FeaturedEventsQuery",
  text: "query FeaturedEventsQuery { featuredEvents { __typename } }",
  metadata: {},
};

const asFetch = (fn: GraphQLNetworkServiceDependencies["fetch"]) => fn;

// Models a request on a dead connection: it settles only when aborted.
const stallUntilAborted = (signal: AbortSignal) =>
  new Promise<Response>((_, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });

function makeDependencies(
  overrides: Partial<GraphQLNetworkServiceDependencies> = {},
): GraphQLNetworkServiceDependencies {
  return {
    defaultBackendUrl: "https://backend.example",
    legacyApiToken: "legacy-token",
    getTelemetryHeaders: async () => ({
      "x-hccna-app-version": "1.1.4",
      "x-hccna-app-build": "10",
      "x-hccna-device-type": "phone",
      "x-hccna-device-model": "iPhone",
      "x-hccna-os-name": "iOS",
      "x-hccna-os-version": "18.0",
    }),
    getAuth: () => ({ currentUser: { uid: "user-1" } }),
    getIdToken: async () => "firebase-token",
    signInAnonymously: async () => ({ user: { uid: "anonymous-user" } }),
    isStatsigReady: () => Effect.succeed(false),
    getStatsigBackendEndpoint: () => Effect.succeed(null),
    recordTelemetry: () => Effect.void,
    fetch: asFetch(
      vi.fn(async () =>
        Response.json({
          data: {
            home: {
              id: "home",
            },
          },
        }),
      ),
    ),
    async *parseMultipart() {
      yield {
        data: {
          home: {
            id: "home",
          },
        },
      };
    },
    ...overrides,
  };
}

function provideGraphQLNetwork(
  dependencies: GraphQLNetworkServiceDependencies,
) {
  return Layer.succeed(
    GraphQLNetworkService,
    makeGraphQLNetworkService(dependencies),
  );
}

describe("GraphQLNetworkService", () => {
  effectIt.effect(
    "retries a query's transient token refresh without replacing the signed-in user",
    () =>
      Effect.gen(function* () {
        const getIdToken = vi
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error("Network unavailable"), {
              code: "auth/network-request-failed",
            }),
          )
          .mockResolvedValue("firebase-token");
        const dependencies = makeDependencies({
          getIdToken,
          signInAnonymously: vi.fn(),
        });
        const service = makeGraphQLNetworkService(dependencies);
        const fiber = yield* service
          .execute({
            operation,
            variables: {},
            signal: new AbortController().signal,
            sink: { next: vi.fn() },
          })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(1000);
        yield* Fiber.join(fiber);
        expect(getIdToken).toHaveBeenCalledTimes(2);
        expect(dependencies.fetch).toHaveBeenCalledOnce();
        expect(dependencies.signInAnonymously).not.toHaveBeenCalled();
      }),
  );

  effectIt.effect(
    "cancels a stalled query attempt at the deadline and retries it",
    () =>
      Effect.gen(function* () {
        const signals: AbortSignal[] = [];
        const fetch = vi.fn(
          (_url: string, request: { signal: AbortSignal }) => {
            signals.push(request.signal);
            // The deadline must not depend on the native request honoring abort.
            return signals.length === 1
              ? new Promise<Response>(() => {})
              : Promise.resolve(
                  Response.json({ data: { home: { id: "home" } } }),
                );
          },
        );
        const sink = { next: vi.fn() };
        const service = makeGraphQLNetworkService(makeDependencies({ fetch }));
        const fiber = yield* service
          .execute({
            operation,
            variables: {},
            signal: new AbortController().signal,
            sink,
          })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS);
        yield* TestClock.adjust(1000);
        yield* Fiber.join(fiber);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        expect(sink.next).toHaveBeenCalledOnce();
      }),
  );

  effectIt.effect(
    "fails a query that stalls on every attempt so the retry UI can show",
    () =>
      Effect.gen(function* () {
        const signals: AbortSignal[] = [];
        const outcomes: string[] = [];
        const fetch = vi.fn(
          (_url: string, request: { signal: AbortSignal }) => {
            signals.push(request.signal);
            return stallUntilAborted(request.signal);
          },
        );
        const service = makeGraphQLNetworkService(
          makeDependencies({
            fetch,
            recordTelemetry: (telemetry) =>
              Effect.sync(() => {
                outcomes.push(telemetry.outcome);
              }),
          }),
        );
        const fiber = yield* service
          .execute({
            operation,
            variables: {},
            signal: new AbortController().signal,
            sink: { next: vi.fn() },
          })
          .pipe(Effect.flip, Effect.forkChild);
        yield* TestClock.adjust(GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS);
        yield* TestClock.adjust(1000);
        yield* TestClock.adjust(GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS);
        yield* TestClock.adjust(2000);
        yield* TestClock.adjust(GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS);
        const error = yield* Fiber.join(fiber);
        expect(error).toMatchObject({
          _tag: "GraphQLRequestError",
          operationName: "FeaturedEventsQuery",
          cause: { name: "TimeoutError" },
        });
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(outcomes).toEqual(["timeout"]);
      }),
  );

  effectIt.effect("never replays a mutation after its deadline", () =>
    Effect.gen(function* () {
      const fetch = vi.fn((_url: string, request: { signal: AbortSignal }) =>
        stallUntilAborted(request.signal),
      );
      const service = makeGraphQLNetworkService(makeDependencies({ fetch }));
      const fiber = yield* service
        .execute({
          operation: { ...operation, operationKind: "mutation" },
          variables: {},
          signal: new AbortController().signal,
          sink: { next: vi.fn() },
        })
        .pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust(GRAPHQL_REQUEST_ATTEMPT_TIMEOUT_MS);
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({ _tag: "GraphQLRequestError" });
      expect(fetch).toHaveBeenCalledOnce();
    }),
  );

  test("cancels the in-flight request when Relay unsubscribes", async () => {
    const signals: AbortSignal[] = [];
    const outcomes: string[] = [];
    const fetch = vi.fn((_url: string, request: { signal: AbortSignal }) => {
      signals.push(request.signal);
      return stallUntilAborted(request.signal);
    });
    const service = makeGraphQLNetworkService(
      makeDependencies({
        fetch,
        recordTelemetry: (telemetry) =>
          Effect.sync(() => {
            outcomes.push(telemetry.outcome);
          }),
      }),
    );
    const relay = new AbortController();
    const execution = Effect.runPromise(
      service.execute({
        operation,
        variables: {},
        signal: relay.signal,
        sink: { next: vi.fn() },
      }),
    );
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    relay.abort();
    await execution;
    expect(signals[0]?.aborted).toBe(true);
    expect(outcomes).toEqual(["aborted"]);
  });

  test.each([
    new TypeError("Network request failed"),
    new Error(
      "fetch failed: UnexpectedException: The Internet connection appears to be offline.",
    ),
  ])("never replays a mutation after %s", async (cause) => {
    const fetch = vi.fn().mockRejectedValue(cause);
    const service = makeGraphQLNetworkService(makeDependencies({ fetch }));
    await expect(
      Effect.runPromise(
        service.execute({
          operation: { ...operation, operationKind: "mutation" },
          variables: {},
          signal: new AbortController().signal,
          sink: { next: vi.fn() },
        }),
      ),
    ).rejects.toMatchObject({ _tag: "GraphQLRequestError" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("does not downgrade an authenticated mutation when ID token retrieval fails", async () => {
    const signInAnonymously = vi.fn();
    const dependencies = makeDependencies({
      getIdToken: async () => {
        throw new Error("Token refresh unavailable");
      },
      signInAnonymously,
    });
    await expect(
      Effect.runPromise(
        executeGraphQLRequest({
          operation: {
            ...operation,
            operationKind: "mutation",
            name: "PushTokensRegisterPushTokenMutation",
          },
          variables: {},
          cacheConfig: null,
          signal: new AbortController().signal,
          sink: { next: vi.fn() },
        }).pipe(Effect.provide(provideGraphQLNetwork(dependencies))),
      ),
    ).rejects.toThrow("Token refresh unavailable");
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(dependencies.fetch).not.toHaveBeenCalled();
  });

  test.each([
    "http://api.hccnj.org",
    "https://attacker.example",
    "https://user:password@api.hccnj.org",
  ])(
    "does not send Firebase credentials to an untrusted configured endpoint: %s",
    async (configuredEndpoint) => {
      const dependencies = makeDependencies({
        isStatsigReady: () => Effect.succeed(true),
        getStatsigBackendEndpoint: () => Effect.succeed(configuredEndpoint),
      });

      await Effect.runPromise(
        executeGraphQLRequest({
          operation,
          variables: {},
          cacheConfig: null,
          signal: new AbortController().signal,
          sink: { next: vi.fn() },
        }).pipe(Effect.provide(provideGraphQLNetwork(dependencies))),
      );

      expect(dependencies.fetch).toHaveBeenCalledWith(
        "https://backend.example/graphql",
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer firebase-token",
          }),
        }),
      );
      expect(dependencies.fetch).not.toHaveBeenCalledWith(
        `${configuredEndpoint}/graphql`,
        expect.any(Object),
      );
    },
  );

  test("sends requests to the Stellate edge when remote config selects it", async () => {
    const dependencies = makeDependencies({
      isStatsigReady: () => Effect.succeed(true),
      getStatsigBackendEndpoint: () =>
        Effect.succeed("https://hccna.stellate.sh"),
    });

    await Effect.runPromise(
      executeGraphQLRequest({
        operation,
        variables: {},
        cacheConfig: null,
        signal: new AbortController().signal,
        sink: { next: vi.fn() },
      }).pipe(Effect.provide(provideGraphQLNetwork(dependencies))),
    );

    expect(dependencies.fetch).toHaveBeenCalledWith(
      "https://hccna.stellate.sh/graphql",
      expect.any(Object),
    );
  });

  test("records privacy-safe request duration and response bytes", async () => {
    const result = {
      data: {
        message: "Welcome 👋",
      },
    };
    const telemetryEvents: Parameters<
      GraphQLNetworkServiceDependencies["recordTelemetry"]
    >[0][] = [];
    const dependencies = makeDependencies({
      fetch: asFetch(vi.fn(async () => Response.json(result))),
      recordTelemetry: (telemetry) =>
        Effect.sync(() => {
          telemetryEvents.push(telemetry);
        }),
    });

    await Effect.runPromise(
      executeGraphQLRequest({
        operation,
        variables: { privateValue: "must-not-be-recorded" },
        cacheConfig: null,
        signal: new AbortController().signal,
        sink: { next: vi.fn() },
      }).pipe(Effect.provide(provideGraphQLNetwork(dependencies))),
    );

    expect(telemetryEvents).toEqual([
      {
        operationName: "FeaturedEventsQuery",
        outcome: "success",
        durationMs: expect.any(Number),
        statusCode: 200,
        responseBytes: new TextEncoder().encode(JSON.stringify(result))
          .byteLength,
      },
    ]);
    expect(telemetryEvents[0]).not.toHaveProperty("variables");
    expect(telemetryEvents[0]).not.toHaveProperty("payload");
  });
});

describe("notification identity bootstrap", () => {
  test("never starts guest auth when an existing account cannot refresh its token", async () => {
    const signInAnonymously = vi.fn();
    const service = makeGraphQLNetworkService(
      makeDependencies({
        signInAnonymously,
        getIdToken: () => Promise.reject(new Error("offline")),
      }),
    );
    await expect(
      Effect.runPromise(service.ensureClientIdentity()),
    ).rejects.toMatchObject({ _tag: "GraphQLRequestError" });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});
