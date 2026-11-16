import { RuleTester } from "oxlint/plugins-dev";

import { noExtraStateLibraryRule } from "./no-extra-state-library.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "restricted" };

tester.run("mobile/no-extra-state-library", noExtraStateLibraryRule, {
  valid: [
    'import { LegendList } from "@legendapp/list";',
    'import { useState } from "react";',
    'import { RegistryContext, useAtomValue } from "@effect/atom-react";',
    'import { Atom } from "effect/reactivity";',
  ],
  invalid: [
    { name: "jotai", code: 'import { atom } from "jotai";', errors: [error] },
    {
      name: "jotai subpath",
      code: 'import { atomWithStorage } from "jotai/utils";',
      errors: [error],
    },
    {
      name: "legend core",
      code: 'import { observable } from "@legendapp/state";',
      errors: [error],
    },
    {
      name: "legend react",
      code: 'import { useObservable } from "@legendapp/state/react";',
      errors: [error],
    },
    {
      name: "type only",
      code: 'import type { Atom } from "jotai";',
      errors: [error],
    },
    { name: "export all", code: 'export * from "jotai";', errors: [error] },
    {
      name: "named re-export",
      code: 'export { atom } from "jotai";',
      errors: [error],
    },
  ],
});
