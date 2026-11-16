import { Predicate, Context, Effect } from "effect";

import { AppCheckInitializationError } from "@/effect/errors";

type AndroidAppCheckProvider = "debug" | "playIntegrity";
type AppleAppCheckProvider = "debug" | "appAttestWithDeviceCheckFallback";

export type AppCheckProviderConfig = {
  readonly android: {
    readonly provider: AndroidAppCheckProvider;
    readonly debugToken?: string;
  };
  readonly apple: {
    readonly provider: AppleAppCheckProvider;
    readonly debugToken?: string;
  };
};

export type AppCheckServiceDependencies = {
  readonly isDebugBuild: boolean;
  readonly debugToken: string | undefined;
  readonly configureProvider: (config: AppCheckProviderConfig) => void;
  readonly activate: (options: {
    readonly isTokenAutoRefreshEnabled: boolean;
  }) => Promise<void>;
};

export type AppCheckServiceApi = {
  readonly initialize: () => Effect.Effect<void, AppCheckInitializationError>;
};

export class AppCheckService extends Context.Service<
  AppCheckService,
  AppCheckServiceApi
>()("AppCheckService") {}

function getUnknownMessage(cause: unknown, fallback: string): string {
  if (
    Predicate.isObjectOrArray(cause) &&
    "message" in cause &&
    Predicate.isString(cause.message) &&
    cause.message.length > 0
  ) {
    return cause.message;
  }

  return fallback;
}

function appCheckInitializationError(cause: unknown) {
  return new AppCheckInitializationError({
    message: getUnknownMessage(
      cause,
      "Firebase App Check initialization failed",
    ),
    cause,
  });
}

function makeProviderConfig(
  dependencies: AppCheckServiceDependencies,
): AppCheckProviderConfig {
  if (dependencies.isDebugBuild && dependencies.debugToken) {
    return {
      android: {
        provider: "debug",
        debugToken: dependencies.debugToken,
      },
      apple: {
        provider: "debug",
        debugToken: dependencies.debugToken,
      },
    };
  }

  return {
    android: { provider: "playIntegrity" },
    apple: { provider: "appAttestWithDeviceCheckFallback" },
  };
}

export function makeAppCheckService(
  dependencies: AppCheckServiceDependencies,
): AppCheckServiceApi {
  const initialize = Effect.fn("AppCheckService.initialize")(function* () {
    if (dependencies.isDebugBuild && !dependencies.debugToken) {
      yield* Effect.logWarning(
        "EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN is not configured; Firebase App Check will use real attestation providers in this debug build",
      );
    }

    yield* Effect.try({
      try: () => {
        dependencies.configureProvider(makeProviderConfig(dependencies));
      },
      catch: appCheckInitializationError,
    });

    yield* Effect.tryPromise({
      try: () => dependencies.activate({ isTokenAutoRefreshEnabled: true }),
      catch: appCheckInitializationError,
    });
  });

  return { initialize };
}

export const initializeAppCheck = Effect.fn(
  "AppCheckService.access.initialize",
)(function* () {
  const service = yield* AppCheckService;
  return yield* service.initialize();
});
