import { Context, Effect, Metric } from "effect";

export const GRAPHQL_NETWORK_REQUEST_EVENT = "graphql_network_request";

export type GraphQLRequestOutcome = "aborted" | "error" | "success" | "timeout";

export type GraphQLRequestTelemetry = {
  readonly operationName: string;
  readonly outcome: GraphQLRequestOutcome;
  readonly durationMs: number;
  readonly statusCode?: number;
  readonly responseBytes?: number;
};

type GraphQLTelemetryEventMetadata = {
  readonly operation_name: string;
  readonly outcome: GraphQLRequestOutcome;
  readonly status_code: string;
  readonly duration_ms: string;
  response_bytes?: string;
};

export type GraphQLTelemetryServiceDependencies = {
  readonly logEvent: (
    eventName: string,
    value: number | null,
    metadata: GraphQLTelemetryEventMetadata,
  ) => Effect.Effect<void>;
};

export type GraphQLTelemetryServiceApi = {
  readonly recordRequest: (
    telemetry: GraphQLRequestTelemetry,
  ) => Effect.Effect<void>;
};

export class GraphQLTelemetryService extends Context.Service<
  GraphQLTelemetryService,
  GraphQLTelemetryServiceApi
>()("GraphQLTelemetryService") {}

const requestCount = Metric.counter("graphql_requests_total", {
  description: "Total GraphQL network requests",
  incremental: true,
});
const requestDuration = Metric.histogram("graphql_request_duration_ms", {
  description: "GraphQL network request duration in milliseconds",
  boundaries: Metric.exponentialBoundaries({
    start: 1,
    factor: 2,
    count: 15,
  }),
});
const responseBytes = Metric.counter("graphql_response_bytes_total", {
  description: "Total GraphQL response bytes",
  incremental: true,
});

export function makeGraphQLTelemetryService(
  dependencies: GraphQLTelemetryServiceDependencies,
): GraphQLTelemetryServiceApi {
  const recordRequest = Effect.fn("GraphQLTelemetryService.recordRequest")(
    function* (telemetry: GraphQLRequestTelemetry) {
      const attributes = {
        operation_name: telemetry.operationName,
        outcome: telemetry.outcome,
        status_code:
          telemetry.statusCode === undefined
            ? "none"
            : String(telemetry.statusCode),
      };

      yield* Metric.update(Metric.withAttributes(requestCount, attributes), 1);
      yield* Metric.update(
        Metric.withAttributes(requestDuration, attributes),
        telemetry.durationMs,
      );

      if (telemetry.responseBytes !== undefined) {
        yield* Metric.update(
          Metric.withAttributes(responseBytes, attributes),
          telemetry.responseBytes,
        );
      }

      const metadata: GraphQLTelemetryEventMetadata = {
        ...attributes,
        duration_ms: String(telemetry.durationMs),
      };

      if (telemetry.responseBytes !== undefined) {
        metadata.response_bytes = String(telemetry.responseBytes);
      }

      yield* Effect.exit(
        dependencies.logEvent(
          GRAPHQL_NETWORK_REQUEST_EVENT,
          telemetry.responseBytes ?? null,
          metadata,
        ),
      );
    },
  );

  return { recordRequest };
}
