import { KNOWN_OPERATION_NAMES_LIST } from "@/graphql/known-operation-names";
import { isDocumentParseResult, isIntrospectionOperation } from "@/graphql/useRequireOperationName";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { GraphQLError } from "graphql";
import { LRUCache } from "lru-cache";

import type { Plugin } from "graphql-yoga";

const KNOWN_OPERATION_NAMES: ReadonlySet<string> = new Set(KNOWN_OPERATION_NAMES_LIST);

/**
 * Persisted-operations preparation (see docs/opencode-v2-architecture-lessons.md §5).
 *
 * Checks the PARSED DOCUMENT's operation names, not the client-supplied
 * `operationName` param — the param can be omitted (graphql-js still executes
 * a single-operation document) or set to any string, so it is not a trustworthy
 * enforcement key. Introspection operations are detected by shape, not name.
 *
 * Log-only by default: unknown operation names are logged so the allowlist can
 * be completed from real traffic before enforcement. With `enforce: true`
 * (GRAPHQL_REQUIRE_KNOWN_OPERATIONS=true), documents containing unknown named
 * operations are rejected — flip this only after mobile clients ship a
 * build-time operation manifest and old-version traffic has decayed.
 *
 * Anonymous operations are handled by useRequireOperationName.
 */
export function useKnownOperationGuard(options: { enforce: boolean }): Plugin {
	// Log-only mode warns once per name; the bound keeps arbitrary probe names from growing it.
	const reportedOperationNames = new LRUCache<string, true>({ max: 500 });

	return {
		onParse() {
			return ({ result }) => {
				if (!isDocumentParseResult(result)) {
					return;
				}

				for (const definition of result.definitions) {
					if (definition.kind === "OperationDefinition") {
						const operationName = definition.name?.value;
						const isUnknownOperation =
							operationName &&
							!isIntrospectionOperation(definition) &&
							!KNOWN_OPERATION_NAMES.has(operationName);

						if (isUnknownOperation) {
							if (options.enforce) {
								getLogger().warn({ operationName }, "Rejected unknown GraphQL operation");
								throw new GraphQLError("Unknown operation name.");
							}

							if (!reportedOperationNames.has(operationName)) {
								reportedOperationNames.set(operationName, true);
								getLogger().warn(
									{ operationName },
									"Unknown GraphQL operation observed (log-only)",
								);
							}
						}
					}
				}
			};
		},
	};
}
