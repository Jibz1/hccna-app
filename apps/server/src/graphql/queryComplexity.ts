import { isIntrospectionOperation } from "@/graphql/useRequireOperationName";
import {
	getNamedType,
	GraphQLError,
	isCompositeType,
	isInterfaceType,
	isListType,
	isNonNullType,
	isObjectType,
	SchemaMetaFieldDef,
	TypeMetaFieldDef,
	TypeNameMetaFieldDef,
	type DocumentNode,
	type FragmentDefinitionNode,
	type GraphQLCompositeType,
	type GraphQLField,
	type GraphQLNamedType,
	type GraphQLObjectType,
	type GraphQLSchema,
	type OperationDefinitionNode,
	type SelectionSetNode,
} from "graphql";

import type { Plugin } from "graphql-yoga";

type ComplexityCoordinate = `${string}.${string}`;

interface QueryComplexityConfig {
	readonly schema: GraphQLSchema;
	readonly maximumComplexity: number;
	readonly maximumComplexityByFieldName?: Readonly<Record<string, number>>;
	readonly defaultFieldComplexity?: number;
	readonly defaultListComplexity?: number;
	readonly fieldComplexityByCoordinate?: Partial<Record<ComplexityCoordinate, number>>;
}

interface ComplexityCalculationContext {
	readonly schema: GraphQLSchema;
	readonly defaultFieldComplexity: number;
	readonly defaultListComplexity: number;
	readonly fieldComplexityByCoordinate: Partial<Record<ComplexityCoordinate, number>>;
	readonly fragments: Map<string, FragmentDefinitionNode>;
	readonly visitedFragments: Set<string>;
}

export const DEFAULT_QUERY_COMPLEXITY_FIELD_COSTS = {
	"Query.campuses": 5,
	"Query.campusesV2": 5,
	"Query.events": 5,
	"Query.upcomingEventsByMonth": 5,
	"Query.sermons": 5,
	"Query.castrStream": 5,
	"Query.getPreviousFiveYearsGivingV2": 10,
	"Query.myGivingHistory": 10,
	"Query.exportAttendance": 25,
	"Mutation.exportEventAttendancePdf": 25,
	"Mutation.exportEventAttendeesPdf": 25,
	// Each call emails an address the caller chooses, so one document may hold only a few.
	"Mutation.createSignInCode": 500,
	"Mutation.createEmailLink": 500,
} satisfies Partial<Record<ComplexityCoordinate, number>>;

export const DEFAULT_QUERY_COMPLEXITY_FIELD_MAXIMUMS = {
	getPreviousFiveYearsGivingV2: 12_000,
	myGivingHistory: 12_000,
	givingHistory: 12_000,
	upcomingEventsByMonth: 12_000,
} satisfies Readonly<Record<string, number>>;

function getOperationRootType(
	schema: GraphQLSchema,
	operation: OperationDefinitionNode["operation"],
): GraphQLObjectType | undefined {
	switch (operation) {
		case "query": {
			return schema.getQueryType() ?? undefined;
		}
		case "mutation": {
			return schema.getMutationType() ?? undefined;
		}
		case "subscription": {
			return schema.getSubscriptionType() ?? undefined;
		}
	}
}

function getFieldDefinition(
	schema: GraphQLSchema,
	parentType: GraphQLCompositeType,
	fieldName: string,
): GraphQLField<GraphQLNamedType, unknown> | undefined {
	if (fieldName === "__typename") {
		return TypeNameMetaFieldDef;
	}

	if (fieldName === "__schema" && parentType === schema.getQueryType()) {
		return SchemaMetaFieldDef;
	}

	if (fieldName === "__type" && parentType === schema.getQueryType()) {
		return TypeMetaFieldDef;
	}

	if (fieldName.startsWith("__")) {
		return undefined;
	}

	if (isObjectType(parentType) || isInterfaceType(parentType)) {
		return parentType.getFields()[fieldName];
	}
}

function getListDepth(type: GraphQLField<GraphQLNamedType, unknown>["type"]): number {
	if (isNonNullType(type)) {
		return getListDepth(type.ofType);
	}

	if (isListType(type)) {
		return 1 + getListDepth(type.ofType);
	}

	return 0;
}

function calculateSelectionSetComplexity(
	parentType: GraphQLCompositeType,
	selectionSet: SelectionSetNode,
	context: ComplexityCalculationContext,
): number {
	let totalComplexity = 0;

	for (const selection of selectionSet.selections) {
		if (selection.kind === "Field") {
			// The Stellate edge adds __typename to every selection set before
			// forwarding, so charging it would score the same app query higher at
			// the edge than at the origin. Unaliased copies merge into one key.
			if (selection.name.value === "__typename" && !selection.alias) {
				continue;
			}

			const fieldDefinition = getFieldDefinition(context.schema, parentType, selection.name.value);
			if (fieldDefinition) {
				const coordinate = `${parentType.name}.${selection.name.value}`;
				const fieldComplexity =
					context.fieldComplexityByCoordinate[coordinate as ComplexityCoordinate] ??
					context.defaultFieldComplexity;
				const listDepth = getListDepth(fieldDefinition.type);
				const listMultiplier = listDepth > 0 ? context.defaultListComplexity ** listDepth : 1;
				const listSurcharge = listDepth * context.defaultListComplexity;
				const childType = getNamedType(fieldDefinition.type);
				const childComplexity =
					selection.selectionSet && isCompositeType(childType)
						? calculateSelectionSetComplexity(childType, selection.selectionSet, context)
						: 0;

				totalComplexity += fieldComplexity + listSurcharge + childComplexity * listMultiplier;
			}
		} else if (selection.kind === "InlineFragment") {
			const nextParentType = selection.typeCondition
				? context.schema.getType(selection.typeCondition.name.value)
				: parentType;

			if (nextParentType && isCompositeType(nextParentType)) {
				totalComplexity += calculateSelectionSetComplexity(
					nextParentType,
					selection.selectionSet,
					context,
				);
			}
		} else {
			const fragmentName = selection.name.value;
			const fragment = context.fragments.get(fragmentName);
			const fragmentType = fragment
				? context.schema.getType(fragment.typeCondition.name.value)
				: undefined;

			if (
				fragment &&
				fragmentType &&
				isCompositeType(fragmentType) &&
				!context.visitedFragments.has(fragmentName)
			) {
				context.visitedFragments.add(fragmentName);
				totalComplexity += calculateSelectionSetComplexity(
					fragmentType,
					fragment.selectionSet,
					context,
				);
				context.visitedFragments.delete(fragmentName);
			}
		}
	}

	return totalComplexity;
}

function getSelectedOperation(
	document: DocumentNode,
	operationName?: string,
): OperationDefinitionNode | undefined {
	const selectedOperation = document.definitions.find((definition) => {
		if (definition.kind !== "OperationDefinition") {
			return false;
		}

		if (operationName) {
			return definition.name?.value === operationName;
		}

		return definition.name === undefined;
	});

	const operationDefinitions = document.definitions.filter(
		(definition): definition is OperationDefinitionNode =>
			definition.kind === "OperationDefinition",
	);

	if (selectedOperation?.kind === "OperationDefinition") {
		return selectedOperation;
	}

	if (operationName === undefined && operationDefinitions.length === 1) {
		return operationDefinitions[0];
	}
}

function collectSelectedFieldNames(
	selectionSet: SelectionSetNode,
	fragments: Map<string, FragmentDefinitionNode>,
	visitedFragments = new Set<string>(),
): Set<string> {
	const fieldNames = new Set<string>();
	const addNestedFieldNames = (nestedSelectionSet: SelectionSetNode) => {
		for (const nested of collectSelectedFieldNames(
			nestedSelectionSet,
			fragments,
			visitedFragments,
		)) {
			fieldNames.add(nested);
		}
	};

	for (const selection of selectionSet.selections) {
		if (selection.kind === "Field") {
			fieldNames.add(selection.name.value);
			if (selection.selectionSet) {
				addNestedFieldNames(selection.selectionSet);
			}
		} else if (selection.kind === "InlineFragment") {
			addNestedFieldNames(selection.selectionSet);
		} else {
			const fragmentName = selection.name.value;
			if (!visitedFragments.has(fragmentName)) {
				const fragment = fragments.get(fragmentName);
				if (fragment) {
					visitedFragments.add(fragmentName);
					addNestedFieldNames(fragment.selectionSet);
					visitedFragments.delete(fragmentName);
				}
			}
		}
	}

	return fieldNames;
}

function getMaximumComplexityForOperation(
	operation: OperationDefinitionNode | undefined,
	fragments: Map<string, FragmentDefinitionNode>,
	config: QueryComplexityConfig,
): number {
	if (!operation || !config.maximumComplexityByFieldName) {
		return config.maximumComplexity;
	}

	const { maximumComplexity } = config;
	const selectedFieldNames = collectSelectedFieldNames(operation.selectionSet, fragments);

	let effectiveMaximumComplexity = maximumComplexity;
	for (const [fieldName, fieldMaximum] of Object.entries(config.maximumComplexityByFieldName)) {
		if (selectedFieldNames.has(fieldName)) {
			effectiveMaximumComplexity = Math.max(effectiveMaximumComplexity, fieldMaximum);
		}
	}

	return effectiveMaximumComplexity;
}

export function calculateDocumentComplexity(
	document: DocumentNode,
	config: QueryComplexityConfig,
	operationName?: string,
): number {
	const {
		schema,
		defaultFieldComplexity = 1,
		defaultListComplexity = 10,
		fieldComplexityByCoordinate = {},
	} = config;

	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const definition of document.definitions) {
		if (definition.kind === "FragmentDefinition") {
			fragments.set(definition.name.value, definition);
		}
	}

	const context: ComplexityCalculationContext = {
		schema,
		defaultFieldComplexity,
		defaultListComplexity,
		fieldComplexityByCoordinate,
		fragments,
		visitedFragments: new Set<string>(),
	};

	const selectedOperation = getSelectedOperation(document, operationName);
	if (!selectedOperation) {
		return 0;
	}

	const rootType = getOperationRootType(schema, selectedOperation.operation);
	if (!rootType) {
		return 0;
	}

	return calculateSelectionSetComplexity(rootType, selectedOperation.selectionSet, context);
}

interface ComplexityVerdict {
	readonly complexity: number;
	readonly maximumComplexity: number;
}

export function useQueryComplexity(config: QueryComplexityConfig): Plugin {
	// Complexity is purely structural: it depends only on the document AST and
	// the selected operation, never on variable values or the caller. Yoga's
	// parser cache reuses DocumentNode instances for repeated query strings
	// (including APQ hits), so memoizing per document avoids re-walking the
	// selection set on every request. WeakMap keys follow the parser cache's
	// eviction, so this cannot leak or be poisoned across distinct documents.
	const verdictsByDocument = new WeakMap<DocumentNode, Map<string, ComplexityVerdict>>();

	const getVerdict = (
		document: DocumentNode,
		operationName: string | undefined,
	): ComplexityVerdict => {
		const operationKey = operationName ?? "";
		const cached = verdictsByDocument.get(document)?.get(operationKey);
		if (cached) {
			return cached;
		}

		const selectedOperation = getSelectedOperation(document, operationName);
		const fragments = new Map<string, FragmentDefinitionNode>();
		for (const definition of document.definitions) {
			if (definition.kind === "FragmentDefinition") {
				fragments.set(definition.name.value, definition);
			}
		}

		// Only a document that selects nothing but __schema/__type goes unscored: one introspection
		// field beside ordinary fields must not waive the limit for the rest.
		const verdict: ComplexityVerdict =
			selectedOperation && isIntrospectionOperation(selectedOperation)
				? { complexity: 0, maximumComplexity: config.maximumComplexity }
				: {
						complexity: calculateDocumentComplexity(document, config, operationName),
						maximumComplexity: getMaximumComplexityForOperation(
							selectedOperation,
							fragments,
							config,
						),
					};

		// Only memoize names that resolve to a real operation — otherwise a
		// caller could grow the per-document map with arbitrary operationName
		// strings (execution rejects them later, but after this hook runs).
		if (selectedOperation) {
			let verdicts = verdictsByDocument.get(document);
			if (!verdicts) {
				verdicts = new Map();
				verdictsByDocument.set(document, verdicts);
			}
			verdicts.set(operationKey, verdict);
		}

		return verdict;
	};

	return {
		onExecute({ args, setResultAndStopExecution }) {
			const { complexity, maximumComplexity } = getVerdict(
				args.document as DocumentNode,
				args.operationName,
			);

			if (complexity > maximumComplexity) {
				setResultAndStopExecution({
					errors: [
						new GraphQLError(
							`Query is too complex: ${complexity}. Maximum allowed complexity: ${maximumComplexity}`,
							{
								extensions: {
									code: "QUERY_TOO_COMPLEX",
									complexity,
									maximumComplexity,
								},
							},
						),
					],
				});
			}
		},
	};
}
