import { Context, Effect } from "effect";

type SentrySampleRateKey = "errors" | "transactions";

export type SentrySamplerContext = {
  readonly inheritOrSampleWith: (sampleRate: number) => unknown;
};

export type SentryBreadcrumb = import("@sentry/react-native").Breadcrumb;

export type SentryConfig = import("@sentry/react-native").ReactNativeOptions;

export type SentryServiceDependencies = {
  readonly defaultErrorSampleRate: number;
  readonly defaultTraceSampleRate: number;
  readonly getPlatform: () => string;
  // The Expo config version: X.Y.N on an OTA update, X.Y.0 on the store bundle.
  readonly getOtaVersion: () => string | undefined;
  readonly getRandom: () => number;
  readonly isDevelopment: () => boolean;
  readonly isStatsigReady: () => boolean;
  readonly getStatsigSampleRate: (
    key: SentrySampleRateKey,
    defaultValue: number,
  ) => number;
  readonly makeConfig: (helpers: {
    readonly getSampleRate: (
      key: SentrySampleRateKey,
      defaultValue: number,
    ) => number;
    readonly getRandom: () => number;
    readonly isDevelopment: boolean;
  }) => SentryConfig;
  readonly init: (config: SentryConfig) => void;
  readonly addBreadcrumb: (breadcrumb: SentryBreadcrumb) => void;
  readonly captureException: (cause: unknown) => void;
  readonly setTag: (key: string, value: string) => void;
};

export type SentryServiceApi = {
  readonly addBreadcrumb: (breadcrumb: SentryBreadcrumb) => Effect.Effect<void>;
  readonly captureException: (cause: unknown) => Effect.Effect<void>;
  readonly getConfig: () => Effect.Effect<SentryConfig>;
  readonly getSampleRate: (
    key: SentrySampleRateKey,
    defaultValue: number,
  ) => Effect.Effect<number>;
  readonly init: () => Effect.Effect<void>;
};

export class SentryService extends Context.Service<
  SentryService,
  SentryServiceApi
>()("SentryService") {}

export function makeSentryService(
  dependencies: SentryServiceDependencies,
): SentryServiceApi {
  let config: SentryConfig | undefined;
  let initialized = false;

  const getSampleRateSync = (
    key: SentrySampleRateKey,
    defaultValue: number,
  ) => {
    if (!dependencies.isStatsigReady()) {
      return defaultValue;
    }

    try {
      return dependencies.getStatsigSampleRate(key, defaultValue);
    } catch {
      return defaultValue;
    }
  };

  const getConfigSync = () => {
    config ??= dependencies.makeConfig({
      getSampleRate: getSampleRateSync,
      getRandom: dependencies.getRandom,
      isDevelopment: dependencies.isDevelopment(),
    });

    return config;
  };

  const getSampleRate = Effect.fn("SentryService.getSampleRate")(function* (
    key: SentrySampleRateKey,
    defaultValue: number,
  ) {
    yield* Effect.void;
    return getSampleRateSync(key, defaultValue);
  });

  const getConfig = Effect.fn("SentryService.getConfig")(function* () {
    yield* Effect.void;
    return getConfigSync();
  });

  const init = Effect.fn("SentryService.init")(function* () {
    yield* Effect.void;

    if (initialized) {
      return;
    }

    dependencies.init(getConfigSync());
    dependencies.setTag("app_platform", dependencies.getPlatform());
    const otaVersion = dependencies.getOtaVersion();
    if (otaVersion) {
      dependencies.setTag("ota_version", otaVersion);
    }
    initialized = true;
  });

  const captureException = Effect.fn("SentryService.captureException")(
    function* (cause: unknown) {
      let captureFailure: unknown;

      yield* Effect.sync(() => {
        try {
          dependencies.captureException(cause);
        } catch (cause) {
          captureFailure = cause;
        }
      });

      if (captureFailure) {
        yield* Effect.log("Failed to capture Sentry exception", {
          cause: captureFailure,
        });
      }
    },
  );

  const addBreadcrumb = Effect.fn("SentryService.addBreadcrumb")(function* (
    breadcrumb: SentryBreadcrumb,
  ) {
    yield* Effect.try(() => {
      dependencies.addBreadcrumb(breadcrumb);
    }).pipe(Effect.catch(() => Effect.log("Failed to add Sentry breadcrumb")));
  });

  return {
    addBreadcrumb,
    captureException,
    getConfig,
    getSampleRate,
    init,
  };
}

export const addSentryBreadcrumb = Effect.fn(
  "SentryService.access.addBreadcrumb",
)(function* (breadcrumb: SentryBreadcrumb) {
  const service = yield* SentryService;
  return yield* service.addBreadcrumb(breadcrumb);
});

export const captureSentryException = Effect.fn(
  "SentryService.access.captureException",
)(function* (cause: unknown) {
  const service = yield* SentryService;
  return yield* service.captureException(cause);
});

export const getSentryConfig = Effect.fn("SentryService.access.getConfig")(
  function* () {
    const service = yield* SentryService;
    return yield* service.getConfig();
  },
);

export const initSentryService = Effect.fn("SentryService.access.init")(
  function* () {
    const service = yield* SentryService;
    return yield* service.init();
  },
);
