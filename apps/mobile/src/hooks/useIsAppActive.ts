import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

function subscribeToAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => {
    subscription.remove();
  };
}

const isAppActive = () => AppState.currentState === "active";

/** False while the app is inactive (e.g. app switcher) or backgrounded. */
export function useIsAppActive() {
  return useSyncExternalStore(subscribeToAppState, isAppActive, () => false);
}
