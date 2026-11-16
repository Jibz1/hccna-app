import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");

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
	console.error(`observability-policy: ${message}`);
	process.exit(1);
}

const sourceFiles = walk(SRC_DIR).filter((file) => !file.includes("__tests__"));

for (const file of sourceFiles) {
	const contents = readFileSync(file, "utf8");
	const rel = relative(ROOT, file);
	const pinoImport = /\b(?:require\(['"`]pino['"`]\)|from\s+['"`]pino['"`])/u.test(contents);

	if (pinoImport && rel !== "src/transport/http/pinoLoggerMiddleware.ts") {
		fail(`direct pino import is not allowed outside central logger: ${rel}`);
	}

	if (
		/console\.(?:log|info|warn|error)\([\s\S]*?(?:req|request|res|response)\.(?:body|json)/iu.test(
			contents,
		)
	) {
		fail(`raw request/response body logging detected: ${rel}`);
	}
}

console.log("observability-policy: ok");
