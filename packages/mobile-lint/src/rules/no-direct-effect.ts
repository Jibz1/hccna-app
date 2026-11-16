import { defineRule } from "@oxlint/plugins";

import { staticMemberName } from "../shared/member-name.ts";
import { reactNamespaceBindings } from "../shared/react-imports.ts";
import { resolveVariable } from "../shared/scope.ts";

const effectHooks: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

/** Ban React's effect hooks outside the shared `@/hooks/effects` wrappers. */
export const noDirectEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow useEffect, useLayoutEffect and useInsertionEffect imported from react.",
    },
    messages: {
      directEffect:
        'Do not use `{{name}}` here. Compute the value during render, do the work in the event handler that causes it, read stores with `useSyncExternalStore`, or use a hook from `@/hooks/effects`. See "Effects, timers and guarded imports" in apps/mobile/AGENTS.md.',
    },
  },
  createOnce(context) {
    let namespaces: ReadonlySet<string> = new Set();

    return {
      Program(program) {
        namespaces = reactNamespaceBindings(program);
        for (const statement of program.body) {
          if (statement.type !== "ImportDeclaration" || statement.source.value !== "react") {
            continue;
          }
          for (const specifier of statement.specifiers) {
            if (specifier.type !== "ImportSpecifier") continue;
            const imported = specifier.imported;
            const name = imported.type === "Identifier" ? imported.name : imported.value;
            if (!effectHooks.has(name)) continue;
            const variable = resolveVariable(context.sourceCode, specifier.local);
            if (variable === null) continue;
            for (const reference of variable.references) {
              context.report({
                node: reference.identifier,
                messageId: "directEffect",
                data: { name },
              });
            }
          }
        }
      },
      ExportSpecifier(node) {
        const parent = node.parent;
        if (parent.type !== "ExportNamedDeclaration") return;
        if (parent.source === null || parent.source.value !== "react") return;
        const local = node.local;
        const name = local.type === "Identifier" ? local.name : local.value;
        if (effectHooks.has(name)) {
          context.report({ node, messageId: "directEffect", data: { name } });
        }
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier") return;
        const name = staticMemberName(node);
        if (name === null || !effectHooks.has(name)) return;
        if (!namespaces.has(node.object.name)) return;
        const variable = resolveVariable(context.sourceCode, node.object);
        if (variable === null || variable.defs[0]?.type !== "ImportBinding") return;
        context.report({
          node,
          messageId: "directEffect",
          data: { name },
        });
      },
    };
  },
});
