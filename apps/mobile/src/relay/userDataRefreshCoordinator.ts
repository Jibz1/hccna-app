import type { Environment } from "relay-runtime";

type RefreshSubscription = {
  unsubscribe(): void;
};

type RefreshSource = {
  subscribe(observer: {
    complete?: () => void;
    error?: (cause: unknown) => void;
  }): RefreshSubscription;
};

type InFlightRefresh = {
  readonly promise: Promise<void>;
  readonly retain: () => () => void;
};

type UserDataRefreshCoordinatorOptions = {
  readonly onComplete?: (
    environment: Environment,
    operationName: string,
  ) => void;
  readonly onError?: (
    cause: unknown,
    environment: Environment,
    operationName: string,
  ) => void;
};

export function createUserDataRefreshCoordinator({
  onComplete,
  onError,
}: UserDataRefreshCoordinatorOptions = {}) {
  const inFlightRefreshes = new WeakMap<
    Environment,
    Map<string, InFlightRefresh>
  >();

  const clearInFlightRefresh = (
    environment: Environment,
    operationName: string,
    promise: Promise<void>,
  ) => {
    const operationRefreshes = inFlightRefreshes.get(environment);
    if (!operationRefreshes) {
      return;
    }

    if (operationRefreshes.get(operationName)?.promise !== promise) {
      return;
    }

    operationRefreshes.delete(operationName);
    if (operationRefreshes.size === 0) {
      inFlightRefreshes.delete(environment);
    }
  };

  return {
    start({
      environment,
      execute,
      operationName,
    }: {
      environment: Environment;
      execute: () => RefreshSource;
      operationName: string;
    }) {
      const existingRefresh = inFlightRefreshes
        .get(environment)
        ?.get(operationName);
      if (existingRefresh) {
        return {
          promise: existingRefresh.promise,
          release: existingRefresh.retain(),
        };
      }

      let activeConsumers = 0;
      let settled = false;
      let subscription: RefreshSubscription | undefined;
      let resolvePromise!: () => void;
      let rejectPromise!: (cause: unknown) => void;

      const promise = new Promise<void>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      void promise.catch(() => {});

      const finalize = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        clearInFlightRefresh(environment, operationName, promise);
        callback();
      };

      const cancel = () => {
        finalize(() => {
          subscription?.unsubscribe();
          rejectPromise(
            new Error(`[Relay] Cancelled user data refresh: ${operationName}`),
          );
        });
      };

      const retain = () => {
        activeConsumers += 1;
        let released = false;

        return () => {
          if (released) {
            return;
          }

          released = true;
          if (settled) {
            return;
          }

          activeConsumers -= 1;
          if (activeConsumers === 0) {
            cancel();
          }
        };
      };

      const operationRefreshes =
        inFlightRefreshes.get(environment) ?? new Map();
      operationRefreshes.set(operationName, { promise, retain });
      inFlightRefreshes.set(environment, operationRefreshes);

      try {
        subscription = execute().subscribe({
          complete: () => {
            finalize(() => {
              resolvePromise();
              onComplete?.(environment, operationName);
            });
          },
          error: (cause: unknown) => {
            finalize(() => {
              rejectPromise(cause);
              onError?.(cause, environment, operationName);
            });
          },
        });
      } catch (error) {
        finalize(() => {
          rejectPromise(error);
          onError?.(error, environment, operationName);
        });
      }

      return {
        promise,
        release: retain(),
      };
    },
  };
}
