import { restrictedImportRule } from "../shared/restricted-import.ts";

/** Ban Firebase's auth listeners; components read auth state through `useIsLoggedIn`. */
export const noDirectAuthListenerRule = restrictedImportRule({
  description: "Disallow importing Firebase auth state listeners directly.",
  message:
    "Components read auth state with `useIsLoggedIn` from `@/hooks/auth/useIsLoggedIn`; a new listener belongs in a service under `src/effect`.",
  sources: ["@react-native-firebase/auth"],
  names: ["onAuthStateChanged", "onIdTokenChanged", "onUserChanged"],
  members: true,
});
