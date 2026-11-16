import antiSlopRules from "@hccnj/anti-slop/rules";
import { defineConfig } from "oxlint";

export default defineConfig({
	jsPlugins: [
		{
			name: "anti-slop",
			specifier: "@hccnj/anti-slop",
		},
	],
	categories: {
		correctness: "warn",
		suspicious: "warn",
		perf: "warn",
		style: "warn",
		pedantic: "error",
	},
	rules: {
		...antiSlopRules,
		"no-unused-vars": [
			"error",
			{
				args: "after-used",
				argsIgnorePattern: "^_",
				vars: "all",
				varsIgnorePattern: "^_",
			},
		],
		"require-await": "error",
		"sort-keys": "off",
		"no-ternary": "off",
		"one-var": "off",
		"id-length": "off",
		"sort-imports": "off",
		"capitalized-comments": "off",
		"max-statements": "off",
		"no-inline-comments": "off",
		"max-classes-per-file": "off",
		"no-null": "off",
		"new-cap": "off",
		"func-style": "off",
		"func-names": "off",
		"max-lines": "off",
		"no-magic-numbers": "off",
		"no-restricted-imports": [
			"error",
			{
				paths: [
					{
						name: "pino",
						message: "Use the centralized logger at '@/transport/http/pinoLoggerMiddleware'.",
					},
				],
			},
		],
		"unicorn/filename-case": "off",
		// Effect's Schema.TaggedError is a class factory used in `extends` clauses.
		// OXC 1.80 incorrectly treats those calls as thrown errors and applies an
		// invalid `new Schema.TaggedError()` autofix.
		"unicorn/throw-new-error": "off",
		"max-lines-per-function": [
			"warn",
			{
				max: 600,
			},
		],
		"no-underscore-dangle": [
			"warn",
			{
				allow: ["__type", "__typename", "_exhaustive", "_expose", "_id", "_tag", "_text"],
			},
		],
	},
	overrides: [
		{
			files: ["src/transport/http/pinoLoggerMiddleware.ts"],
			rules: {
				"no-restricted-imports": "off",
			},
		},
	],
	ignorePatterns: ["src/generatedTypes/**/*", "repos/**/*"],
});
