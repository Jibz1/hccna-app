import type {
  DynamicConfig,
  DynamicConfigEvaluationOptions,
  StatsigUser,
} from "@statsig/expo-bindings";
import { Context, Effect } from "effect";

import type { DynamicConfigName } from "@/featureGates/names";

const STATSIG_LOG_EVENT_RETRY_DELAY_MS = 100;
const MAX_STATSIG_LOG_EVENT_RETRY_COUNT = 10;

type InteractionTask = {
  readonly cancel: () => void;
};

export type StatsigEventValue = string | number | null;
export type StatsigEventMetadata = Record<string, string> | null;

export type StatsigClientLike = {
  readonly loadingStatus?: unknown;
  readonly getDynamicConfig: (
    name: string,
    options?: DynamicConfigEvaluationOptions,
  ) => DynamicConfig;
  readonly initializeAsync: () => Promise<unknown>;
  logEvent(
    eventName: string,
    value?: StatsigEventValue,
    metadata?: StatsigEventMetadata,
  ): void;
  readonly updateUserAsync: (user: StatsigUser) => Promise<unknown>;
};

export type StatsigServiceDependencies<Client extends StatsigClientLike> = {
  readonly getUser: () => StatsigUser;
  readonly createClient: (user: StatsigUser) => Client;
  readonly usersEqual: (previous: StatsigUser, next: StatsigUser) => boolean;
  readonly scheduleAfterInteractions: (
    task: () => void | Promise<void>,
  ) => InteractionTask;
  readonly addUserChangeListeners: (listener: () => void) => void;
};

export type StatsigServiceApi<
  Client extends StatsigClientLike = StatsigClientLike,
> = {
  readonly getClient: () => Effect.Effect<Client>;
  readonly getDynamicConfig: (
    name: DynamicConfigName,
    options?: DynamicConfigEvaluationOptions,
  ) => Effect.Effect<DynamicConfig>;
  readonly initialize: () => Effect.Effect<void, never>;
  readonly isReady: () => Effect.Effect<boolean>;
  readonly logEvent: (
    eventName: string,
    value?: StatsigEventValue,
    metadata?: StatsigEventMetadata,
  ) => Effect.Effect<void>;
  readonly syncUser: () => Effect.Effect<void, never>;
};

export class StatsigService extends Context.Service<
  StatsigService,
  StatsigServiceApi
>()("StatsigService") {}

export function makeStatsigService<Client extends StatsigClientLike>(
  dependencies: StatsigServiceDependencies<Client>,
): StatsigServiceApi<Client> {
  let currentUser: StatsigUser | null = null;
  let client: Client | null = null;
  let initializationPromise: Promise<void> | null = null;

  const getCurrentUser = () => {
    currentUser ??= dependencies.getUser();
    return currentUser;
  };

  const getClient = Effect.fn("StatsigService.getClient")(function* () {
    yield* Effect.void;

    if (client) {
      return client;
    }

    client = dependencies.createClient(getCurrentUser());
    return client;
  });

  const getDynamicConfig = Effect.fn("StatsigService.getDynamicConfig")(
    function* (
      name: DynamicConfigName,
      options?: DynamicConfigEvaluationOptions,
    ) {
      const statsig = yield* getClient();
      return statsig.getDynamicConfig(name, options);
    },
  );

  const syncUserPromise = async () => {
    const nextUser = dependencies.getUser();

    if (currentUser && dependencies.usersEqual(currentUser, nextUser)) {
      return;
    }

    currentUser = nextUser;
    const statsig = client ?? dependencies.createClient(getCurrentUser());
    client = statsig;
    await statsig.updateUserAsync(currentUser);
  };

  const syncUser = Effect.fn("StatsigService.syncUser")(function* () {
    yield* Effect.promise(syncUserPromise);
  });

  const initialize = Effect.fn("StatsigService.initialize")(function* () {
    const statsig = yield* getClient();

    initializationPromise ??= statsig.initializeAsync().then(async () => {
      await syncUserPromise();

      let task: InteractionTask | undefined;
      dependencies.addUserChangeListeners(() => {
        task?.cancel();
        task = dependencies.scheduleAfterInteractions(() => {
          syncUserPromise().catch(() => undefined);
        });
      });
    });

    yield* Effect.promise(() => initializationPromise as Promise<void>);
  });

  const isReady = Effect.fn("StatsigService.isReady")(function* () {
    const statsig = yield* getClient();
    return statsig.loadingStatus === "Ready";
  });

  const logEventWhenReady = (
    statsig: Client,
    eventName: string,
    value?: StatsigEventValue,
    metadata?: StatsigEventMetadata,
    retryCount = 0,
  ) => {
    try {
      if (statsig.loadingStatus !== "Ready") {
        if (initializationPromise) {
          initializationPromise
            .then(() => {
              statsig.logEvent(eventName, value, metadata);
            })
            .catch(() => undefined);
          return;
        }

        if (retryCount >= MAX_STATSIG_LOG_EVENT_RETRY_COUNT) {
          console.warn("Dropping Statsig event before initialization", {
            eventName,
            value,
            metadata,
          });
          return;
        }

        setTimeout(() => {
          logEventWhenReady(
            statsig,
            eventName,
            value,
            metadata,
            retryCount + 1,
          );
        }, STATSIG_LOG_EVENT_RETRY_DELAY_MS);
        return;
      }

      statsig.logEvent(eventName, value, metadata);
    } catch {
      // Analytics should never break app flows.
    }
  };

  const logEvent = Effect.fn("StatsigService.logEvent")(function* (
    eventName: string,
    value?: StatsigEventValue,
    metadata?: StatsigEventMetadata,
  ) {
    const statsig = yield* getClient();
    yield* Effect.sync(() => {
      logEventWhenReady(statsig, eventName, value, metadata);
    });
  });

  return {
    getClient,
    getDynamicConfig,
    initialize,
    isReady,
    logEvent,
    syncUser,
  };
}

export const getStatsigClient = Effect.fn("StatsigService.access.getClient")(
  function* () {
    const service = yield* StatsigService;
    return yield* service.getClient();
  },
);

export const getStatsigDynamicConfig = Effect.fn(
  "StatsigService.access.getDynamicConfig",
)(function* (
  name: DynamicConfigName,
  options?: DynamicConfigEvaluationOptions,
) {
  const service = yield* StatsigService;
  return yield* service.getDynamicConfig(name, options);
});

export const initializeStatsig = Effect.fn("StatsigService.access.initialize")(
  function* () {
    const service = yield* StatsigService;
    return yield* service.initialize();
  },
);

export const isStatsigReady = Effect.fn("StatsigService.access.isReady")(
  function* () {
    const service = yield* StatsigService;
    return yield* service.isReady();
  },
);

export const logStatsigEvent = Effect.fn("StatsigService.access.logEvent")(
  function* (
    eventName: string,
    value?: StatsigEventValue,
    metadata?: StatsigEventMetadata,
  ) {
    const service = yield* StatsigService;
    return yield* service.logEvent(eventName, value, metadata);
  },
);
