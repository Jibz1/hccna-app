import { Effect, Layer } from "effect";

import {
  makeRelayPersistenceTelemetryService,
  RelayPersistenceTelemetryService,
} from "@/effect/relayPersistenceTelemetryService";
import { StatsigService } from "@/effect/statsigService";
import { StatsigServiceLive } from "@/effect/statsigServiceLive";

const RelayPersistenceTelemetryServiceLayer = Layer.effect(
  RelayPersistenceTelemetryService,
  Effect.gen(function* () {
    const statsig = yield* StatsigService;

    return makeRelayPersistenceTelemetryService({
      logEvent: (eventName, value, metadata) =>
        statsig.logEvent(eventName, value, metadata),
    });
  }),
);

export const RelayPersistenceTelemetryServiceLive =
  RelayPersistenceTelemetryServiceLayer.pipe(Layer.provide(StatsigServiceLive));
