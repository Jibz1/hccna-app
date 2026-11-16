import { defineRule } from "@oxlint/plugins";

type RestrictedImportOptions = {
  readonly description: string;
  readonly message: string;
  /** Exact module names, or a prefix ending in "/" that matches every subpath. */
  readonly sources: readonly string[];
  /** Imported names to ban, or "all" to ban the module itself. */
  readonly names: readonly string[] | "all";
  /**
   * Also ban a non-computed member access to one of `names` on any object
   * (`getAuth().onAuthStateChanged`), for APIs that are also reachable as methods.
   */
  readonly members?: boolean;
};

const matchesSource = (sources: readonly string[], source: string): boolean =>
  sources.some((entry) => (entry.endsWith("/") ? source.startsWith(entry) : source === entry));

/** Build a rule that bans importing, or re-exporting, named bindings from specific modules. */
export const restrictedImportRule = (options: RestrictedImportOptions) => {
  const { description, message, sources, names, members = false } = options;
  const bannedNames: ReadonlySet<string> | null = names === "all" ? null : new Set(names);

  return defineRule({
    meta: {
      type: "problem",
      docs: { description },
      messages: {
        restricted: `Do not import \`{{name}}\` from \`{{source}}\`. ${message}`,
        restrictedMember: `Do not use \`{{name}}\` directly. ${message}`,
      },
    },
    createOnce(context) {
      return {
        ImportDeclaration(node) {
          const source = node.source.value;
          if (!matchesSource(sources, source)) return;
          if (bannedNames === null) {
            context.report({
              node,
              messageId: "restricted",
              data: { name: source, source },
            });
            return;
          }
          for (const specifier of node.specifiers) {
            // A namespace or default import reaches every banned name at once.
            if (specifier.type !== "ImportSpecifier") {
              context.report({
                node: specifier,
                messageId: "restricted",
                data: {
                  name:
                    specifier.type === "ImportNamespaceSpecifier"
                      ? `* as ${specifier.local.name}`
                      : "default",
                  source,
                },
              });
              continue;
            }
            const name =
              specifier.imported.type === "Identifier"
                ? specifier.imported.name
                : specifier.imported.value;
            if (!bannedNames.has(name)) continue;
            context.report({
              node: specifier,
              messageId: "restricted",
              data: { name, source },
            });
          }
        },
        MemberExpression(node) {
          if (!members || bannedNames === null) return;
          if (node.computed || node.property.type !== "Identifier") return;
          if (!bannedNames.has(node.property.name)) return;
          context.report({
            node: node.property,
            messageId: "restrictedMember",
            data: { name: node.property.name },
          });
        },
        ExportAllDeclaration(node) {
          const source = node.source.value;
          if (bannedNames !== null || !matchesSource(sources, source)) return;
          context.report({
            node,
            messageId: "restricted",
            data: { name: source, source },
          });
        },
        ExportNamedDeclaration(node) {
          if (node.source === null) return;
          const source = node.source.value;
          if (!matchesSource(sources, source)) return;
          if (bannedNames === null) {
            context.report({
              node,
              messageId: "restricted",
              data: { name: source, source },
            });
            return;
          }
          for (const specifier of node.specifiers) {
            const name =
              specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value;
            if (!bannedNames.has(name)) continue;
            context.report({
              node: specifier,
              messageId: "restricted",
              data: { name, source },
            });
          }
        },
      };
    },
  });
};
