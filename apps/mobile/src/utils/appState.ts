import { AppState, type AppStateStatus } from "react-native";

const APP_STATE_STATUSES: ReadonlySet<string> = new Set<AppStateStatus>([
  "active",
  "background",
  "inactive",
  "extension",
  "unknown",
]);

const isAppStateStatus = (state: string): state is AppStateStatus =>
  APP_STATE_STATUSES.has(state);

// React Native types `AppState.currentState` as any string, or null before
// the native module reports a state. Callers compare it with change events,
// which only carry `AppStateStatus` values.
export function currentAppState(): AppStateStatus {
  const state = AppState.currentState;
  return state != null && isAppStateStatus(state) ? state : "unknown";
}
