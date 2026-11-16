import { RuleTester } from "oxlint/plugins-dev";

import { noDirectAuthListenerRule } from "./no-direct-auth-listener.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "restricted" };
const memberError = { messageId: "restrictedMember" };

tester.run("mobile/no-direct-auth-listener", noDirectAuthListenerRule, {
  valid: [
    'import { getAuth, signInAnonymously } from "@react-native-firebase/auth";',
    "getAuth().currentUser;",
    'const events = { onAuthStateChanged: true }; events["onAuthStateChanged"];',
  ],
  invalid: [
    {
      name: "state",
      code: 'import { getAuth, onAuthStateChanged } from "@react-native-firebase/auth";',
      errors: [error],
    },
    {
      name: "message",
      code: 'import { onAuthStateChanged } from "@react-native-firebase/auth";',
      errors: [
        {
          message:
            "Do not import `onAuthStateChanged` from `@react-native-firebase/auth`. Components read auth state with `useIsLoggedIn` from `@/hooks/auth/useIsLoggedIn`; a new listener belongs in a service under `src/effect`.",
        },
      ],
    },
    {
      name: "member call",
      code: "getAuth().onAuthStateChanged((user) => {});",
      errors: [memberError],
    },
    {
      name: "member on instance",
      code: "auth.onIdTokenChanged(listener); auth.onUserChanged(listener);",
      errors: [memberError, memberError],
    },
    {
      name: "namespace import",
      code: 'import * as Auth from "@react-native-firebase/auth";',
      errors: [error],
    },
    {
      name: "token",
      code: 'import { onIdTokenChanged } from "@react-native-firebase/auth";',
      errors: [error],
    },
  ],
});
