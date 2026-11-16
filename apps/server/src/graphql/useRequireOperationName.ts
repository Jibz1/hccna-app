import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { Predicate } from "effect";
import { GraphQLError, Kind, type DocumentNode, type OperationDefinitionNode } from "graphql";

import type { Plugin } from "graphql-yoga";

/**
 * Whether the operation only introspects the schema: every root selection is
 * `__schema` or `__type`, and there is at least one. The unaliased `__typename`
 * the Stellate edge adds to each selection set is ignored, so a forwarded
 * introspection query still counts; `{ __typename }` alone does not.
 */
export function isIntrospectionOperation(definition: OperationDefinitionNode): boolean {
	const selections = (definition.selectionSet?.selections ?? []).filter(
		(selection) =>
			!(selection.kind === "Field" && selection.name.value === "__typename" && !selection.alias),
	);
	if (selections.length === 0) {
		return false;
	}
	return selections.every(
		(selection) =>
			selection.kind === "Field" &&
			(selection.name.value === "__schema" || selection.name.value === "__type"),
	);
}

function isAnonymousNonIntrospection(definition: OperationDefinitionNode): boolean {
	return !definition.name?.value && !isIntrospectionOperation(definition);
}

export function isDocumentParseResult<Input>(result: Input): result is Input & DocumentNode {
	return (
		Predicate.isObject(result) &&
		result.kind === Kind.DOCUMENT &&
		Predicate.hasProperty(result, "definitions") &&
		Array.isArray(result.definitions)
	);
}

/**
 * GraphQL Yoga plugin that requires all operations to have a name.
 * Introspection queries are exempt from this requirement.
 */
export function useRequireOperationName(): Plugin {
	return {
		onParse() {
			return ({ result }) => {
				if (!isDocumentParseResult(result)) {
					return;
				}

				for (const definition of result.definitions) {
					if (
						definition.kind === "OperationDefinition" &&
						isAnonymousNonIntrospection(definition)
					) {
						getLogger().warn(
							{ operationType: definition.operation },
							"Rejected anonymous GraphQL operation",
						);
						throw new GraphQLError(
							`All operations must have a name. Please add a name to your query/mutation.`,
						);
					}
				}
			};
		},
	};
}
