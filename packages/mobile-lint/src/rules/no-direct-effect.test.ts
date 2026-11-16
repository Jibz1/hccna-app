import { RuleTester } from "oxlint/plugins-dev";

import { noDirectEffectRule } from "./no-direct-effect.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "directEffect" };

tester.run("mobile/no-direct-effect", noDirectEffectRule, {
  valid: [
    'import { useState, useSyncExternalStore, useEffectEvent } from "react";',
    'import * as React from "react"; React.useState(0);',
    'import { useEffect } from "./local-hooks"; useEffect(() => {}, []);',
    "const useEffect = () => {}; useEffect();",
    'import type { EffectCallback } from "react";',
    'import { useEffect } from "react"; function f(useEffect: () => void) { useEffect(); }',
    'import React from "react"; function f(React: { useEffect(): void }) { React.useEffect(); }',
    'import * as React from "react"; React["useState"](0);',
    'import * as React from "react"; const hook = "useEffect"; React[hook](() => {}, []);',
  ],
  invalid: [
    { name: "call", code: 'import { useEffect } from "react"; useEffect(() => {}, []);', errors: [error] },
    { name: "alias call", code: 'import { useLayoutEffect as useIso } from "react"; useIso(() => {}, []);', errors: [{ ...error, data: { name: "useLayoutEffect" } }] },
    { name: "insertion effect", code: 'import { useInsertionEffect } from "react"; useInsertionEffect(() => {});', errors: [error] },
    { name: "two calls", code: 'import { useEffect } from "react"; useEffect(a, []); useEffect(b, []);', errors: [error, error] },
    { name: "escaping reference", code: 'import { useEffect } from "react"; const fx = useEffect;', errors: [error] },
    { name: "default member", code: 'import React from "react"; React.useEffect(() => {}, []);', errors: [error] },
    { name: "namespace member", code: 'import * as React from "react"; React.useLayoutEffect(() => {}, []);', errors: [error] },
    { name: "bracket member", code: 'import * as React from "react"; React["useEffect"](() => {}, []);', errors: [{ ...error, data: { name: "useEffect" } }] },
    { name: "template bracket member", code: 'import React from "react"; React[`useLayoutEffect`](() => {}, []);', errors: [error] },
    { name: "re-export", code: 'export { useEffect } from "react";', errors: [error] },
  ],
});
