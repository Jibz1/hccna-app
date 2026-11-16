import { Predicate, Cause, Context, Effect, Option } from "effect";

import { AppStartupGoogleSignInConfigError } from "@/effect/errors";

export type AppStartupServiceError = AppStartupGoogleSignInConfigError;

type AppStartupEffect<A> = Effect.Effect<A, AppStartupServiceError>;

export type AppStartupServiceDependencies = {
  readonly captureException: (cause: unknown) => Effect.Effect<void>;
  readonly configureGoogleSignIn: () => void;
  readonly initializeAppCheck: Effect.Effect<void, unknown, never>;
  readonly initializeStatsig: Effect.Effect<void, unknown, never>;
};

export type AppStartupServiceApi = {
  readonly start: () => AppStartupEffect<void>;
};

export class AppStartupService extends Context.Service<
  AppStartupService,
  AppStartupServiceApi
>()("AppStartupService") {}

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

export function makeAppStartupService(
  dependencies: AppStartupServiceDependencies,
): AppStartupServiceApi {
  const captureBackgroundFailure = (cause: Cause.Cause<unknown>) =>
    dependencies.captureException(
      Option.getOrUndefined(Cause.findErrorOption(cause)) ??
        Cause.squash(cause),
    );

  const initializeStatsigSafely = dependencies.initializeStatsig.pipe(
    Effect.catchCause(captureBackgroundFailure),
  );

  const initializeAppCheckSafely = dependencies.initializeAppCheck.pipe(
    Effect.catchCause(captureBackgroundFailure),
  );

  const start = Effect.fn("AppStartupService.start")(function* () {
    yield* Effect.all(
      [
        initializeAppCheckSafely,
        Effect.try({
          try: dependencies.configureGoogleSignIn,
          catch: (cause) =>
            new AppStartupGoogleSignInConfigError({
              message: getUnknownMessage(
                cause,
                "Google Sign-In configuration failed",
              ),
              cause,
            }),
        }),
      ],
      { concurrency: "unbounded", discard: true },
    );

    yield* initializeStatsigSafely.pipe(
      Effect.forkDetach({ startImmediately: true }),
    );
  });

  return {
    start,
  };
}

export const startAppStartup = Effect.fn("AppStartupService.access.start")(
  function* () {
    const service = yield* AppStartupService;
    return yield* service.start();
  },
);
