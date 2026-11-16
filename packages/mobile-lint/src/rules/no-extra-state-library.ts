import { restrictedImportRule } from "../shared/restricted-import.ts";

/** Ban jotai and Legend State; local state and the existing stores cover every need. */
export const noExtraStateLibraryRule = restrictedImportRule({
  description: "Disallow importing jotai or @legendapp/state.",
  message:
    "Use `useState` or `useReducer` for local state. For shared state use a `useSyncExternalStore` store (see `src/utils/devicePrefs.ts`) or an Effect atom.",
  sources: ["jotai", "jotai/", "@legendapp/state", "@legendapp/state/"],
  names: "all",
});
