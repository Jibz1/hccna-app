import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// This process runs inside Railway's private network, with only DATABASE_URL.
// Validation is the default; applying migrations requires an explicit mode.
const mode = process.env.MIGRATION_MODE ?? "validate";
const revision = process.env.MIGRATION_REVISION ?? "manual";
const connectionString = process.env.DATABASE_URL;

if (mode !== "validate" && mode !== "migrate") {
	throw new Error("MIGRATION_MODE must be validate or migrate");
}
if (!connectionString || !new URL(connectionString).hostname.endsWith(".railway.internal")) {
	throw new Error("A private Railway DATABASE_URL is required");
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
try {
	readMigrationFiles({ migrationsFolder: "./drizzle" });
	await pool.query("SELECT 1");
	if (mode === "migrate") {
		await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
	}
	console.log(`MIGRATION_RUN_OK ${revision} ${mode}`);
} catch (error) {
	// Database errors can include SQL and values. Keep CI logs free of those.
	const code = error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN";
	console.error(`MIGRATION_RUN_FAILED ${code}`);
	process.exitCode = 1;
} finally {
	await pool.end();
}
