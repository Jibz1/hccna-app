import { Effect, Layer } from "effect";

import {
  GraphQLTelemetryService,
  makeGraphQLTelemetryService,
} from "./graphqlTelemetryService";
import { StatsigService } from "./statsigService";

export const GraphQLTelemetryServiceLive = Layer.effect(
  GraphQLTelemetryService,
  Effect.gen(function* () {
    const statsig = yield* StatsigService;

    return makeGraphQLTelemetryService({
      logEvent: (eventName, value, metadata) =>
        statsig.logEvent(eventName, value, metadata),
    });
  }),
);
