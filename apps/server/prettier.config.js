export default {
	printWidth: 80,
	semi: true,
	trailingComma: "all",
	singleQuote: true,
	useTabs: true,
	plugins: ["@ianvs/prettier-plugin-sort-imports"],
	importOrder: ["<BUILT_IN_MODULES>", "<THIRD_PARTY_MODULES>", "", "^@/(.*)$", "", "^[.]"],
	importOrderParserPlugins: ["typescript", "decorators-legacy"],
};
