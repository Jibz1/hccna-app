import { RuleTester } from "oxlint/plugins-dev";

import { noRawTimersRule } from "./no-raw-timers.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "rawTimer" };

tester.run("mobile/no-raw-timers", noRawTimersRule, {
  valid: [
    "clearTimeout(handle); clearInterval(handle); cancelAnimationFrame(frame);",
    "let timer: ReturnType<typeof setTimeout> | undefined;",
    "function run(setTimeout: (fn: () => void, ms: number) => number) { setTimeout(() => {}, 1); }",
    "options.setTimeout(() => {}, 1);",
    'globalThis["clearTimeout"](handle);',
    "globalThis[name](() => {}, 1);",
    'import { setTimeout } from "node:timers/promises"; await setTimeout(1);',
  ],
  invalid: [
    { name: "setTimeout", code: "setTimeout(() => {}, 100);", errors: [error] },
    { name: "setInterval", code: "const id = setInterval(tick, 1000);", errors: [error] },
    { name: "setImmediate", code: "setImmediate(() => {});", errors: [error] },
    { name: "animation frame", code: "requestAnimationFrame(() => {});", errors: [error] },
    { name: "idle callback", code: "requestIdleCallback(() => {});", errors: [error] },
    { name: "globalThis member", code: "globalThis.setTimeout(() => {}, 1);", errors: [error] },
    { name: "window member", code: "window.requestAnimationFrame(() => {});", errors: [error] },
    { name: "bracket member", code: 'globalThis["setTimeout"](() => {}, 1);', errors: [{ ...error, data: { name: "setTimeout" } }] },
    { name: "template bracket member", code: "window[`setInterval`](tick, 1000);", errors: [error] },
    { name: "escaping reference", code: "const later = setTimeout;", errors: [error] },
    { name: "two calls", code: "setTimeout(a); setTimeout(b);", errors: [error, error] },
    {
      name: "message",
      code: "requestIdleCallback(work);",
      errors: [
        {
          message:
            "Do not call `requestIdleCallback` directly. In a component use `useTimeout` or `useInterval` from `@/hooks/effects`; in async code use `sleep` or `withTimeout` from `@/utils/timers`; in Effect code use `Effect.sleep`, `Effect.timeout` or `Schedule`. To defer non-urgent work use `scheduleIdleTask` from `@/utils/scheduleIdleTask`. A delay must not stand in for a readiness signal.",
        },
      ],
    },
  ],
});

// Shared configs (oxlint-config-universe, `env: { browser: true }`) declare the timer
// names and `window` as globals; a declared global must still be reported.
const declaredGlobals = new RuleTester({
  languageOptions: {
    parserOptions: { lang: "ts" },
    globals: {
      setTimeout: "readonly",
      setInterval: "readonly",
      setImmediate: "readonly",
      requestAnimationFrame: "readonly",
      requestIdleCallback: "readonly",
      window: "readonly",
    },
  },
});

declaredGlobals.run("mobile/no-raw-timers with declared globals", noRawTimersRule, {
  valid: [
    "let timer: ReturnType<typeof setTimeout> | undefined;",
    "function run(setTimeout: (fn: () => void, ms: number) => number) { setTimeout(() => {}, 1); }",
    'import { setTimeout } from "node:timers/promises"; await setTimeout(1);',
    "const window = { setTimeout() {} }; window.setTimeout();",
  ],
  invalid: [
    { name: "setTimeout", code: "setTimeout(() => {}, 100);", errors: [error] },
    { name: "setInterval", code: "const id = setInterval(tick, 1000);", errors: [error] },
    { name: "setImmediate", code: "setImmediate(() => {});", errors: [error] },
    { name: "animation frame", code: "requestAnimationFrame(() => {});", errors: [error] },
    { name: "idle callback", code: "requestIdleCallback(() => {});", errors: [error] },
    { name: "window member", code: "window.setTimeout(() => {}, 1);", errors: [error] },
    { name: "bracket member", code: 'window["setTimeout"](() => {}, 1);', errors: [error] },
    { name: "escaping reference", code: "const later = setTimeout;", errors: [error] },
    { name: "nested call", code: "function f() { return () => { setTimeout(g, 1); }; }", errors: [error] },
  ],
});
