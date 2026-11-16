import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const GUARDED_ROUTE_FILES = new Set([
	"src/routes/v1/api.ts",
	"src/routes/v1/attendance-exports.ts",
	"src/routes/v1/index.ts",
]);
const GUARDED_CMS_GRAPHQL_FILES = new Set([
	"src/graphql/schema/cms/core.ts",
	"src/graphql/schema/cms/home.ts",
	"src/graphql/schema/cms/webhookUpdate.ts",
]);
const RUN_PROMISE_ALLOWED_FILES = new Map([
	["src/index.ts", "application bootstrap"],
	["src/routes/graphql.ts", "GraphQL transport setup"],
	["src/effect/requestExecution.ts", "central request Effect adapter"],
	[
		"src/effect/services/GraphQLResponseCacheService.ts",
		"third-party GraphQL cache callback adapter",
	],
	[
		"src/effect/services/GraphQLRateLimitStoreService.ts",
		"third-party GraphQL rate-limit callback adapter",
	],
]);
const FIREBASE_ALLOWED_FILES = new Map([
	["src/utils/firebase.ts", "Firebase SDK initialization"],
	["src/effect/FirebaseAdminContext.ts", "low-level Firebase context type"],
	["src/effect/Runtime.ts", "runtime bridge for Firebase context"],
	["src/effect/services/FirebaseAdminService.ts", "low-level Firebase platform service"],
	["src/effect/services/FirebaseAuthService.ts", "Firebase auth adapter service"],
	[
		"src/effect/services/AuthService.ts",
		"temporary auth migration bridge through Firebase services",
	],
	["src/effect/services/ExportStorageService.ts", "Firebase storage adapter"],
	["src/effect/services/StreamMappingService.ts", "temporary stream-to-Firebase migration bridge"],
	["src/effect/services/WordOfActivationService.ts", "temporary WOA Firebase migration bridge"],
	["src/services/onboarding/userProvisioning.ts", "temporary onboarding Firebase migration bridge"],
	[
		"src/utils/wordOfActivation/wordOfActivation.ts",
		"temporary WOA Firebase utility migration debt",
	],
	[
		"src/graphql/loaders/firebaseCastrDataLoader.ts",
		"temporary Firebase dataloader migration debt",
	],
	["src/graphql/context.ts", "temporary GraphQL Firebase context bridge"],
	["src/graphql/schema/user/user.ts", "temporary user resolver Firebase migration debt"],
	["src/graphql/schema/user/update-user.ts", "temporary user resolver Firebase migration debt"],
	[
		"src/graphql/schema/user/send-broadcast.ts",
		"temporary broadcast resolver Firebase migration debt",
	],
	["src/effect/services/StreamProjectionStore.ts", "Firestore stream projection adapter"],
]);
const DATA_TAGGED_ERROR_ALLOWED_FILES = new Map([
	["src/graphql/schema/user/user.ts", "temporary user/account GraphQL migration debt"],
]);
const FIREBASE_FORBIDDEN_PATTERNS = [
	/from\s*['"`]@\/utils\/firebase['"`]/u,
	/from\s*['"`]firebase-admin/u,
	/\bdb\s*\.\s*collection\s*\(/u,
	/\bsecondaryDb\s*\.\s*collection\s*\(/u,
];
const CMS_GRAPHQL_FORBIDDEN_PATTERNS = [
	/from\s*['"`]@\/db['"`]/iu,
	/from\s*['"`]@\/db\//iu,
	/from\s*['"`]@\/utils\/stellate['"`]/iu,
	/db\s*\.\s*select\s*\(/iu,
	/db\s*\.\s*insert\s*\(/iu,
	/db\s*\.\s*delete\s*\(/iu,
	/db\s*\.\s*transaction\s*\(/iu,
	/purgeStellateOperations\s*\(/iu,
];

function walk(dir: string): string[] {
	const entries = readdirSync(dir);
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stats = statSync(fullPath);

		if (stats.isDirectory()) {
			files.push(...walk(fullPath));
		} else if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
			files.push(fullPath);
		}
	}

	return files;
}

function fail(message: string): never {
	console.error(`effect-boundaries: ${message}`);
	process.exit(1);
}

function matchesAny(contents: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(contents));
}

const sourceFiles = walk(SRC_DIR).filter(
	(file) => !file.includes("__tests__") && !file.includes("generatedTypes"),
);

for (const file of sourceFiles) {
	const contents = readFileSync(file, "utf8");
	const rel = relative(ROOT, file);

	if (contents.includes("process.env")) {
		fail(`direct process.env access is not allowed: ${rel}`);
	}

	if (
		(contents.includes("managedRuntime.runPromise") || contents.includes("Effect.runPromise(")) &&
		!RUN_PROMISE_ALLOWED_FILES.has(rel)
	) {
		fail(`Effect execution must stay at approved boundaries or listed migration debt: ${rel}`);
	}

	if (matchesAny(contents, FIREBASE_FORBIDDEN_PATTERNS) && !FIREBASE_ALLOWED_FILES.has(rel)) {
		fail(
			`Firebase access must stay behind approved platform services or listed migration debt: ${rel}`,
		);
	}

	if (contents.includes("Data.TaggedError") && !DATA_TAGGED_ERROR_ALLOWED_FILES.has(rel)) {
		fail(
			`new Effect service errors should use Schema.TaggedError or be listed migration debt: ${rel}`,
		);
	}

	if (GUARDED_ROUTE_FILES.has(rel)) {
		if (contents.includes("managedRuntime.runPromise") || contents.includes("Effect.runPromise(")) {
			fail(`routes must use transport Effect adapters instead of runPromise: ${rel}`);
		}

		if (contents.includes("db.collection(") || contents.includes("secondaryDb.collection(")) {
			fail(`routes must not access Firebase directly: ${rel}`);
		}

		if (contents.includes("Schema.Any")) {
			fail(`public route schemas must not use Schema.Any: ${rel}`);
		}
	}

	if (GUARDED_CMS_GRAPHQL_FILES.has(rel) && matchesAny(contents, CMS_GRAPHQL_FORBIDDEN_PATTERNS)) {
		fail(
			`CMS GraphQL resolvers must delegate CMS data, Strapi, and cache work to CMSService: ${rel}`,
		);
	}
}

console.log("effect-boundaries: ok");
