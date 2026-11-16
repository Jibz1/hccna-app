import type { ESTree } from "@oxlint/plugins";

/** Local names of the default and namespace imports of `"react"`. */
export function reactNamespaceBindings(program: ESTree.Program): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== "react") continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportDefaultSpecifier" ||
        specifier.type === "ImportNamespaceSpecifier"
      ) {
        names.add(specifier.local.name);
      }
    }
  }
  return names;
}
