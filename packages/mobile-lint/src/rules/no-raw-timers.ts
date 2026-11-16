import { defineRule, type ESTree } from "@oxlint/plugins";

import { staticMemberName } from "../shared/member-name.ts";
import { resolveVariable } from "../shared/scope.ts";

const timerNames: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
]);

const globalObjectNames: ReadonlySet<string> = new Set(["globalThis", "window", "global"]);

/** Ban the global timer and frame-callback functions in favour of the shared wrappers. */
export const noRawTimersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow setTimeout, setInterval, setImmediate, requestAnimationFrame and requestIdleCallback.",
    },
    messages: {
      rawTimer:
        "Do not call `{{name}}` directly. In a component use `useTimeout` or `useInterval` from `@/hooks/effects`; in async code use `sleep` or `withTimeout` from `@/utils/timers`; in Effect code use `Effect.sleep`, `Effect.timeout` or `Schedule`. To defer non-urgent work use `scheduleIdleTask` from `@/utils/scheduleIdleTask`. A delay must not stand in for a readiness signal.",
    },
  },
  createOnce(context) {
    return {
      Program(program) {
        const globalScope = context.sourceCode.getScope(program);
        // References that no scope in the file binds are references to the global. A name
        // the lint config declares as a global (`globals`, `env`) resolves instead to a
        // global-scope variable with no definitions, so collect those references too.
        const references = [...globalScope.through];
        for (const name of timerNames) {
          const variable = globalScope.set.get(name);
          if (variable !== undefined && variable.defs.length === 0) {
            references.push(...variable.references);
          }
        }
        const reported = new Set<ESTree.Node>();
        for (const reference of references) {
          const identifier = reference.identifier;
          if (!timerNames.has(identifier.name) || reported.has(identifier)) continue;
          if (identifier.parent.type === "TSTypeQuery") continue;
          reported.add(identifier);
          context.report({ node: identifier, messageId: "rawTimer", data: { name: identifier.name } });
        }
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier") return;
        if (!globalObjectNames.has(node.object.name)) return;
        const name = staticMemberName(node);
        if (name === null || !timerNames.has(name)) return;
        const variable = resolveVariable(context.sourceCode, node.object);
        if (variable !== null && variable.defs.length > 0) return;
        context.report({
          node,
          messageId: "rawTimer",
          data: { name },
        });
      },
    };
  },
});
