import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { AppState, type AppStateStatus } from "react-native";

import { currentAppState } from "@/utils/appState";

export type ConnectivityStatus = "online" | "offline" | "unknown";

/**
 * Upper bound on how long foregrounded listeners wait for the connectivity
 * refresh. A hung native `NetInfo.refresh()` must not silently cancel the
 * foreground sweep.
 */
export const FOREGROUND_REFRESH_TIMEOUT_MS = 5_000;

export type ConnectivityStateInput = Pick<
  NetInfoState,
  "isConnected" | "isInternetReachable"
>;

type ConnectivityListener = () => void;

export type ConnectivityAdapterDependencies = {
  readonly getCurrentAppState: () => AppStateStatus;
  readonly refreshNetInfo: () => Promise<ConnectivityStateInput>;
  readonly subscribeAppState: (
    listener: (state: AppStateStatus) => void,
  ) => () => void;
  readonly subscribeNetInfo: (
    listener: (state: ConnectivityStateInput) => void,
  ) => () => void;
};

export type ConnectivityAdapter = {
  readonly getServerSnapshot: () => ConnectivityStatus;
  readonly getSnapshot: () => ConnectivityStatus;
  readonly refresh: () => Promise<ConnectivityStatus>;
  readonly subscribe: (listener: ConnectivityListener) => () => void;
  readonly subscribeConnectivityRestored: (
    listener: ConnectivityListener,
  ) => () => void;
  readonly subscribeForegrounded: (
    listener: ConnectivityListener,
  ) => () => void;
};

export function getConnectivityStatus(
  state: ConnectivityStateInput,
): ConnectivityStatus {
  if (state.isConnected === false || state.isInternetReachable === false) {
    return "offline";
  }

  if (state.isConnected === true) {
    return "online";
  }

  return "unknown";
}

export function createConnectivityAdapter(
  dependencies: ConnectivityAdapterDependencies,
): ConnectivityAdapter {
  const foregroundedListeners = new Set<ConnectivityListener>();
  const restoredListeners = new Set<ConnectivityListener>();
  const snapshotListeners = new Set<ConnectivityListener>();
  let appState = dependencies.getCurrentAppState();
  let connectivityRestoredCount = 0;
  let started = false;
  let status: ConnectivityStatus = "unknown";

  const emitConnectivityRestored = () => {
    connectivityRestoredCount += 1;
    [...restoredListeners].forEach((listener) => {
      listener();
    });
  };

  const updateStatus = (nextStatus: ConnectivityStatus): boolean => {
    const previousStatus = status;
    if (nextStatus === previousStatus) {
      return false;
    }

    status = nextStatus;
    [...snapshotListeners].forEach((listener) => {
      listener();
    });

    if (nextStatus === "online" && previousStatus !== "online") {
      emitConnectivityRestored();
    }

    return true;
  };

  const refresh = async (): Promise<ConnectivityStatus> => {
    const state = await dependencies.refreshNetInfo();
    const nextStatus = getConnectivityStatus(state);
    updateStatus(nextStatus);
    return nextStatus;
  };

  const start = () => {
    if (started) {
      return;
    }

    started = true;
    appState = dependencies.getCurrentAppState();
    dependencies.subscribeNetInfo((state) => {
      updateStatus(getConnectivityStatus(state));
    });
    dependencies.subscribeAppState((nextAppState) => {
      // Only a real background-to-active transition counts. "unknown" is the
      // app-state adapter's initial/indeterminate value (a transition out of
      // it must not trigger a launch sweep), and "inactive" is the transient
      // iOS state entered for Face ID, call banners, and Control Center —
      // those blips are not the user returning to the app.
      const returnedToForeground =
        nextAppState === "active" && appState === "background";
      appState = nextAppState;

      if (!returnedToForeground) {
        return;
      }

      const restoredCountBeforeRefresh = connectivityRestoredCount;
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      void Promise.race([
        refresh(),
        new Promise<null>((resolve) => {
          refreshTimer = setTimeout(() => {
            resolve(null);
          }, FOREGROUND_REFRESH_TIMEOUT_MS);
        }),
      ])
        .catch(() => null)
        .then((nextStatus) => {
          clearTimeout(refreshTimer);

          // Fire only after refresh() settles (or the wait times out) so
          // foregrounded listeners (the revalidation sweep) observe the
          // refreshed connectivity snapshot rather than a stale one.
          // Best-effort: fires whether the refresh succeeded or failed, but
          // not if the user backgrounded the app again while it was pending.
          if (dependencies.getCurrentAppState() === "active") {
            [...foregroundedListeners].forEach((listener) => {
              listener();
            });
          }

          // Restored fires after foregrounded in the steady-online case, so a
          // sweep triggered by this foreground is attributed to "foregrounded"
          // rather than to a phantom connectivity restoration. A genuine
          // offline-to-online flip during the refresh already emitted from
          // updateStatus; the count guard keeps this from duplicating it.
          if (
            nextStatus === "online" &&
            connectivityRestoredCount === restoredCountBeforeRefresh
          ) {
            emitConnectivityRestored();
          }
        });
    });
  };

  return {
    getServerSnapshot: () => "unknown",
    getSnapshot: () => status,
    refresh,
    subscribe: (listener) => {
      snapshotListeners.add(listener);
      start();

      return () => {
        snapshotListeners.delete(listener);
      };
    },
    subscribeConnectivityRestored: (listener) => {
      restoredListeners.add(listener);
      start();

      return () => {
        restoredListeners.delete(listener);
      };
    },
    subscribeForegrounded: (listener) => {
      foregroundedListeners.add(listener);
      start();

      return () => {
        foregroundedListeners.delete(listener);
      };
    },
  };
}

export const connectivity = createConnectivityAdapter({
  getCurrentAppState: currentAppState,
  refreshNetInfo: () => NetInfo.refresh(),
  subscribeAppState: (listener) => {
    const subscription = AppState.addEventListener("change", listener);
    return () => {
      subscription.remove();
    };
  },
  subscribeNetInfo: (listener) => NetInfo.addEventListener(listener),
});
