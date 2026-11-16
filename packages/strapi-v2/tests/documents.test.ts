import { describe, expect, it } from "bun:test";
import { buildSchema, Kind, parse, TypeInfo, validate, visit, visitWithTypeInfo } from "graphql";

import { STRAPI_V2_DOCUMENTS } from "../src/client";

import type { FieldNode } from "graphql";

const schema = buildSchema(await Bun.file(new URL("./fixtures/strapi5.graphql", import.meta.url)).text());

// A selection passes `pagination: { pageSize: 100 }` (or a variable for the page size).
const hasPageSize = (field: FieldNode): boolean => {
	const pagination = field.arguments?.find((argument) => argument.name.value === "pagination")?.value;
	if (pagination?.kind !== Kind.OBJECT) {
		return false;
	}
	const pageSize = pagination.fields.find((entry) => entry.name.value === "pageSize")?.value;
	return pageSize?.kind === Kind.VARIABLE || (pageSize?.kind === Kind.INT && pageSize.value === "100");
};

// Strapi 5 silently applies its default limit (25) to every list that omits `pagination`.
const unpaginatedLists = (operation: string, document: string): string[] => {
	const typeInfo = new TypeInfo(schema);
	const violations: string[] = [];
	visit(
		parse(document),
		visitWithTypeInfo(typeInfo, {
			Field(node) {
				const takesPagination = typeInfo.getFieldDef()?.args.some((argument) => argument.name === "pagination");
				if (takesPagination && !hasPageSize(node)) {
					violations.push(`${operation}: ${node.name.value} lacks pagination pageSize 100`);
				}
			},
		}),
	);
	return violations;
};

describe("Strapi 5 query documents", () => {
	for (const [operation, document] of Object.entries(STRAPI_V2_DOCUMENTS)) {
		it(`${operation} is valid against the recorded CMS schema`, () => {
			const parsed = parse(document);
			expect(validate(schema, parsed).map((error) => error.message)).toEqual([]);
			expect(parsed.definitions.map((definition) => ("name" in definition ? definition.name?.value : undefined))).toEqual([operation]);
		});

		it(`${operation} paginates every list it selects`, () => {
			expect(unpaginatedLists(operation, document)).toEqual([]);
		});
	}
});
