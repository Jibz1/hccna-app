import {
  getAuth,
  getIdToken,
  signInAnonymously,
} from "@react-native-firebase/auth";
import { Predicate, Effect, Layer } from "effect";

import { DYNAMIC_CONFIGS } from "@/featureGates/names";
import { APPS_BACKEND_URL } from "@/utils/constants";
import { parseMultipart } from "@/utils/multipartParser";
import { getTelemetryHeaders } from "@/utils/telemetryHeaders";

import {
  GraphQLNetworkService,
  makeGraphQLNetworkService,
} from "./graphqlNetworkService";
import { GraphQLTelemetryService } from "./graphqlTelemetryService";
import { GraphQLTelemetryServiceLive } from "./graphqlTelemetryServiceLive";
import { getRuntimeEnvString } from "./runtimeConfigService";
import { RuntimeConfigServiceLive } from "./runtimeConfigServiceLive";
import { StatsigService } from "./statsigService";
import { StatsigServiceLive } from "./statsigServiceLive";

const GraphQLNetworkServiceLayer = Layer.effect(
  GraphQLNetworkService,
  Effect.gen(function* () {
    const statsig = yield* StatsigService;
    const telemetry = yield* GraphQLTelemetryService;
    const legacyApiToken = yield* getRuntimeEnvString("EXPO_PUBLIC_API_TOKEN");

    return makeGraphQLNetworkService({
      defaultBackendUrl: APPS_BACKEND_URL,
      legacyApiToken,
      getTelemetryHeaders,
      getAuth,
      getIdToken: (user) =>
        getIdToken(user as Parameters<typeof getIdToken>[0]),
      signInAnonymously: (auth) =>
        signInAnonymously(auth as Parameters<typeof signInAnonymously>[0]),
      isStatsigReady: statsig.isReady,
      getStatsigBackendEndpoint: () =>
        statsig
          .getDynamicConfig(DYNAMIC_CONFIGS.backendGraphqlEndpoint)
          .pipe(
            Effect.map((config) =>
              Predicate.isString(config.value?.backendEndpoint)
                ? config.value.backendEndpoint
                : null,
            ),
          ),
      recordTelemetry: telemetry.recordRequest,
      // Browser fetch requires its global receiver when injected as a method.
      fetch: (url, request) => globalThis.fetch(url, request),
      parseMultipart,
    });
  }),
);

const GraphQLNetworkDependenciesLive = GraphQLTelemetryServiceLive.pipe(
  Layer.provideMerge(StatsigServiceLive),
  Layer.provideMerge(RuntimeConfigServiceLive),
);

export const GraphQLNetworkServiceLive = GraphQLNetworkServiceLayer.pipe(
  Layer.provide(GraphQLNetworkDependenciesLive),
);
