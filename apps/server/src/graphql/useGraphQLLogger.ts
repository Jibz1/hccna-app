import { getParsedRequestDocument } from "@/graphql/sharedResponseCachePolicy";
import {
	setGraphQLErrorCount,
	setGraphQLOperationInfo,
} from "@/transport/http/pinoLoggerMiddleware";
import { Predicate } from "effect";
import {
	getOperationAST,
	type DocumentNode,
	type FragmentDefinitionNode,
	type OperationDefinitionNode,
	type SelectionSetNode,
} from "graphql";
import { isAsyncIterable } from "graphql-yoga";

import type { Plugin } from "graphql-yoga";

/**
 * GraphQL Yoga plugin that extracts operation name and type from parsed queries, and counts
 * the GraphQL errors in the response. Stores both in AsyncLocalStorage for the pino logger
 * middleware to include.
 *
 * Place it after useMarkGraphQLSharedResponseCacheRequests, whose parsed document it reads.
 */
export function useGraphQLLogger(): Plugin {
	return {
		// Response-cache hits end in onParams and never execute, so describe them from the
		// request's document. The app sends no operationName, and params are not validated yet.
		onParams({ params, request }) {
			const document = getParsedRequestDocument(request);
			if (document) {
				recordOperation(
					document,
					Predicate.isString(params.operationName) ? params.operationName : undefined,
				);
			}
		},
		onExecute({ args }) {
			recordOperation(args.document, args.operationName);
		},
		// Every response passes through here: executed, cached, and rejected before execution.
		// A streamed (defer/stream) response has no final count when the request log is written.
		onResultProcess({ result }) {
			if (isAsyncIterable(result)) {
				return;
			}
			const results = Array.isArray(result) ? result : [result];
			setGraphQLErrorCount(results.reduce((count, { errors }) => count + (errors?.length ?? 0), 0));
		},
	};
}

function recordOperation(document: DocumentNode, operationName: string | null | undefined) {
	const operation = getOperationDefinition(document, operationName);

	if (!operation) {
		return;
	}

	setGraphQLOperationInfo({
		operationName: operation.name?.value ?? operationName ?? null,
		operationType: operation.operation,
		fields: collectRootFieldNames(operation, document),
	});
}

function getOperationDefinition(
	document: DocumentNode,
	operationName?: string | null,
): OperationDefinitionNode | null {
	const operation =
		getOperationAST(document, operationName ?? undefined) ??
		document.definitions.find((definition) => definition.kind === "OperationDefinition");

	return operation ?? null;
}

function collectRootFieldNames(
	operation: OperationDefinitionNode,
	document: DocumentNode,
): string[] {
	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const definition of document.definitions) {
		if (definition.kind === "FragmentDefinition") {
			fragments.set(definition.name.value, definition);
		}
	}

	const fields = new Set<string>();
	addFieldsFromSelectionSet(operation.selectionSet, fragments, fields);
	return [...fields];
}

function addFieldsFromSelectionSet(
	selectionSet: SelectionSetNode,
	fragments: Map<string, FragmentDefinitionNode>,
	fields: Set<string>,
) {
	for (const selection of selectionSet.selections) {
		if (selection.kind === "Field") {
			fields.add(selection.name.value);
		} else if (selection.kind === "InlineFragment") {
			addFieldsFromSelectionSet(selection.selectionSet, fragments, fields);
		} else if (selection.kind === "FragmentSpread") {
			const fragment = fragments.get(selection.name.value);
			if (fragment) {
				addFieldsFromSelectionSet(fragment.selectionSet, fragments, fields);
			}
		}
	}
}
