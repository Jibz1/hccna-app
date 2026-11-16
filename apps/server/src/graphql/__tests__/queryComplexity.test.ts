import {
	calculateDocumentComplexity,
	DEFAULT_QUERY_COMPLEXITY_FIELD_COSTS,
	useQueryComplexity,
} from "@/graphql/queryComplexity";
import { describe, expect, it } from "bun:test";
import { buildSchema, GraphQLError, parse, type ExecutionResult } from "graphql";

interface ExecutionState {
	stoppedResult: ExecutionResult | null;
}

const testSchema = buildSchema(`
	type Campus {
		id: ID!
		name: String!
	}

	type Query {
		campuses: [Campus!]!
	}
`);

describe("calculateDocumentComplexity", () => {
	it("expands fragment spreads using the fragment type", () => {
		const document = parse(`
			query Campuses {
				campuses {
					...CampusFields
				}
			}

			fragment CampusFields on Campus {
				id
				name
			}
		`);

		const complexity = calculateDocumentComplexity(document, {
			schema: testSchema,
			maximumComplexity: 1000,
			defaultFieldComplexity: 1,
			defaultListComplexity: 10,
		});

		expect(complexity).toBe(31);
	});

	it("does not charge the __typename the Stellate edge adds to every selection set", () => {
		const config = {
			schema: testSchema,
			maximumComplexity: 1000,
			defaultFieldComplexity: 1,
			defaultListComplexity: 10,
		};
		const asSentByApp = parse(`query Campuses { campuses { id name } }`);
		const asForwardedByEdge = parse(`query Campuses { campuses { __typename id name } }`);

		expect(calculateDocumentComplexity(asForwardedByEdge, config)).toBe(
			calculateDocumentComplexity(asSentByApp, config),
		);
	});

	it("charges an aliased __typename like any other field", () => {
		const document = parse(`query Campuses { campuses { id name kind: __typename } }`);

		const complexity = calculateDocumentComplexity(document, {
			schema: testSchema,
			maximumComplexity: 1000,
			defaultFieldComplexity: 1,
			defaultListComplexity: 10,
		});

		expect(complexity).toBe(41);
	});
});

describe("useQueryComplexity", () => {
	it("rejects the selected operation when it exceeds the configured maximum", async () => {
		const plugin = useQueryComplexity({
			schema: testSchema,
			maximumComplexity: 20,
			defaultFieldComplexity: 1,
			defaultListComplexity: 10,
		});

		const document = parse(`
			query Campuses {
				campuses {
					id
					name
				}
			}
		`);

		const executionState: ExecutionState = {
			stoppedResult: null,
		};

		await plugin.onExecute?.({
			args: {
				document,
				operationName: "Campuses",
			} as never,
			context: {} as never,
			extendContext: () => null,
			executeFn: (() => null) as never,
			setExecuteFn: (() => null) as never,
			setResultAndStopExecution: (nextResult) => {
				executionState.stoppedResult = nextResult;
			},
		});

		const complexityError = executionState.stoppedResult?.errors?.[0];
		expect(complexityError).toBeInstanceOf(GraphQLError);
		expect(complexityError?.extensions?.code).toBe("QUERY_TOO_COMPLEX");
	});

	const stoppedBy = async (plugin: ReturnType<typeof useQueryComplexity>, source: string) => {
		const executionState: ExecutionState = { stoppedResult: null };
		await plugin.onExecute?.({
			args: { document: parse(source) } as never,
			context: {} as never,
			extendContext: () => null,
			executeFn: (() => null) as never,
			setExecuteFn: (() => null) as never,
			setResultAndStopExecution: (nextResult) => {
				executionState.stoppedResult = nextResult;
			},
		});
		return executionState.stoppedResult?.errors?.[0]?.extensions?.code;
	};

	const strictPlugin = () =>
		useQueryComplexity({
			schema: testSchema,
			maximumComplexity: 20,
			defaultFieldComplexity: 1,
			defaultListComplexity: 10,
		});

	it("still limits a query that adds __schema beside ordinary fields", async () => {
		const code = await stoppedBy(
			strictPlugin(),
			`query Campuses { campuses { id name } __schema { queryType { name } } }`,
		);

		expect(code).toBe("QUERY_TOO_COMPLEX");
	});

	it("leaves a query that only introspects the schema unscored", async () => {
		const code = await stoppedBy(
			strictPlugin(),
			`query Introspect { __schema { types { name fields { name args { name } } } } }`,
		);

		expect(code).toBeUndefined();
	});

	it("leaves introspection unscored when the Stellate edge has added __typename", async () => {
		const code = await stoppedBy(
			strictPlugin(),
			`query Introspect {
				__typename
				__schema { __typename types { __typename name fields { __typename name args { name } } } }
			}`,
		);

		expect(code).toBeUndefined();
	});

	it("rejects a document that aliases a mail-sending mutation many times", async () => {
		const mailSchema = buildSchema(`
			type Query { ok: Boolean }
			type Mutation {
				createSignInCode(email: String!): Boolean
				createEmailLink(email: String!): Boolean
			}
		`);
		const plugin = useQueryComplexity({
			schema: mailSchema,
			maximumComplexity: 2000,
			defaultFieldComplexity: 1,
			defaultListComplexity: 10,
			fieldComplexityByCoordinate: DEFAULT_QUERY_COMPLEXITY_FIELD_COSTS,
		});
		const aliases = (field: string) =>
			Array.from({ length: 10 }, (_, i) => `m${i}: ${field}(email: "m${i}@example.com")`).join(" ");

		expect(await stoppedBy(plugin, `mutation Send { ${aliases("createSignInCode")} }`)).toBe(
			"QUERY_TOO_COMPLEX",
		);
		expect(await stoppedBy(plugin, `mutation Send { ${aliases("createEmailLink")} }`)).toBe(
			"QUERY_TOO_COMPLEX",
		);
		expect(
			await stoppedBy(plugin, `mutation Send { createSignInCode(email: "ada@example.com") }`),
		).toBeUndefined();
	});
});
