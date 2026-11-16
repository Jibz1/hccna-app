import type { ESTree } from "@oxlint/plugins";

/**
 * The property name of a member access when the source fixes it: `a.b`, `a["b"]` or
 * `` a[`b`] ``. Returns `null` for a key only known at run time (`a[b]`) and for private fields.
 */
export function staticMemberName(node: ESTree.MemberExpression): string | null {
  const property = node.property;
  if (!node.computed) return property.type === "Identifier" ? property.name : null;
  if (property.type === "Literal") {
    return typeof property.value === "string" ? property.value : null;
  }
  if (property.type === "TemplateLiteral" && property.expressions.length === 0) {
    return property.quasis[0]?.value.cooked ?? null;
  }
  return null;
}
