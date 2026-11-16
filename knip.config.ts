import { type KnipConfig } from "knip";

export default {
	workspaces: {
		"apps/server": {
			// The migration image invokes its script directly, outside package.json.
			entry: ["stellate.ts", "scripts/railway-migrate.ts"],
			ignoreDependencies: [
				// Invoked by scripts/patch-effect-tsgo.ts via its bin path, which knip cannot trace.
				"@effect/tsgo",
				// Used as the tsconfig language-service plugin declared in
				// packages/config/tsconfig/base.json, which knip cannot trace across workspaces.
				"@effect/language-service",
			],
		},
	},
	// Integration packages have their own oxlint runs; anti-slop is vendored upstream.
	// Knip coverage starts with the server
	// (matching the pre-monorepo setup) and can expand workspace by workspace.
	ignoreWorkspaces: [
		"packages/anti-slop",
		"packages/castr",
		"packages/ccb",
		"packages/strapi",
		"packages/strapi-v2",
		"packages/config",
	],
} satisfies KnipConfig;
