#!/usr/bin/env bun
/**
 * Writes `operations.json`: the phase 1 GraphQL operations exactly as the mobile app sends them.
 *
 * Source of truth is the Relay compiler output, `apps/mobile/src/**\/__generated__/*.graphql.ts`.
 * Each artifact's `params` block carries the operation name and the full query text (fragments
 * included). Operation text and variable definitions are code, not data, so the file is committed.
 *
 *   bun apps/server-rs/bench/extract-operations.ts           write operations.json
 *   bun apps/server-rs/bench/extract-operations.ts --check   exit 1 when operations.json is stale
 *
 * Dependency-free on purpose: `apps/server-rs` is not a Bun workspace and has no package.json.
 */
import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

/** The 11 operations covered by phase 1 (spec section "Phases"). Output keeps this order. */
export const PHASE_1_OPERATIONS = [
	"CCBFormsQuery",
	"CampusesQuery",
	"CoreDataQuery",
	"EventDetailQuery",
	"LatestEventsQuery",
	"LatestSermonsQuery",
	"SermonsContainerQuery",
	"SermonsItemsRefetchQuery",
	"ThoughtOfGodImplQuery",
	"ThoughtOfGodQuery",
	"VerseOfTheDayQuery",
] as const;

export interface VariableDefinition {
	readonly name: string;
	/** GraphQL type reference, e.g. `String!` or `Int`. */
	readonly type: string;
	/** The default value as written in the query, e.g. `10`; absent when there is none. */
	readonly defaultValue?: string;
}

export interface BenchOperation {
	readonly name: string;
	/** Repository-relative path of the Relay artifact the text came from. */
	readonly source: string;
	readonly variables: readonly VariableDefinition[];
	readonly text: string;
}

export interface OperationsFile {
	readonly generatedBy: string;
	readonly operations: readonly BenchOperation[];
}

const benchDir = import.meta.dir;
const repoRoot = resolve(benchDir, "../../..");
const operationsPath = join(benchDir, "operations.json");

/** Reads `params.name` and `params.text` from a Relay artifact without executing it. */
export function readParams(
	source: string,
	file: string,
): { name: string; text: string } {
	const start = source.indexOf('"params": {');
	if (start === -1) {
		throw new Error(`${file}: no "params" block`);
	}
	const end = source.indexOf("\n  }", start);
	const block = source.slice(start, end === -1 ? undefined : end);
	const name = /^\s*"name": ("(?:[^"\\]|\\.)*"),?$/mu.exec(block);
	const text = /^\s*"text": ("(?:[^"\\]|\\.)*"),?$/mu.exec(block);
	if (!name?.[1]) {
		throw new Error(`${file}: params.name not found`);
	}
	if (!text?.[1]) {
		// Persisted queries set `text` to null and send an id instead.
		throw new Error(`${file}: params.text is missing (persisted query?)`);
	}
	// Relay writes both as JSON string literals.
	return {
		name: JSON.parse(name[1]) as string,
		text: JSON.parse(text[1]) as string,
	};
}

/** Parses `query Name($a: T = d, $b: U!)` into variable definitions. */
export function parseVariables(text: string): VariableDefinition[] {
	const header = /^\s*query\s+\w+\s*\(([^)]*)\)/u.exec(text);
	if (!header?.[1]) {
		return [];
	}
	const variables: VariableDefinition[] = [];
	for (const match of header[1].matchAll(
		/\$(\w+)\s*:\s*([^\s=$]+)(?:\s*=\s*([^\s$]+))?/gu,
	)) {
		const [, name, type, defaultValue] = match;
		if (!name || !type) {
			continue;
		}
		variables.push(
			defaultValue === undefined
				? { name, type }
				: { name, type, defaultValue },
		);
	}
	return variables;
}

export async function extractOperations(): Promise<OperationsFile> {
	const found = new Map<string, BenchOperation>();
	const glob = new Glob("apps/mobile/src/**/__generated__/*.graphql.ts");
	for await (const path of glob.scan({ cwd: repoRoot })) {
		// Relay names each artifact after its operation; fragments have no params to read.
		const artifact = basename(path, ".graphql.ts");
		if (!(PHASE_1_OPERATIONS as readonly string[]).includes(artifact)) {
			continue;
		}
		const file = join(repoRoot, path);
		const { name, text } = readParams(readFileSync(file, "utf8"), path);
		if (name !== artifact) {
			throw new Error(`${path}: params.name is ${name}, expected ${artifact}`);
		}
		if (found.has(name)) {
			throw new Error(`${name} is defined by more than one artifact`);
		}
		found.set(name, {
			name,
			source: relative(repoRoot, file),
			variables: parseVariables(text),
			text,
		});
	}

	const operations = PHASE_1_OPERATIONS.map((name) => {
		const operation = found.get(name);
		if (!operation) {
			throw new Error(
				`${name}: no Relay artifact found under apps/mobile/src (run the mobile relay compiler)`,
			);
		}
		return operation;
	});
	return {
		generatedBy: "apps/server-rs/bench/extract-operations.ts",
		operations,
	};
}

export function render(file: OperationsFile): string {
	return `${JSON.stringify(file, null, 2)}\n`;
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const rendered = render(await extractOperations());
	if (check) {
		let current = "";
		try {
			current = readFileSync(operationsPath, "utf8");
		} catch {
			// Treated as stale below.
		}
		if (current !== rendered) {
			console.error(
				"apps/server-rs/bench/operations.json is stale. Run: bun apps/server-rs/bench/extract-operations.ts",
			);
			process.exit(1);
		}
		console.log(
			`operations.json is up to date (${PHASE_1_OPERATIONS.length} operations)`,
		);
	} else {
		writeFileSync(operationsPath, rendered);
		console.log(
			`wrote ${relative(repoRoot, operationsPath)} (${PHASE_1_OPERATIONS.length} operations)`,
		);
	}
}
