import { loadAppConfigSync, type AppConfigContract } from "@/effect/AppConfig";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolConfig } from "pg";

import { relations } from "./schema";

export * as schema from "./schema";

const appConfig = loadAppConfigSync();

function createPoolConfig(dbConfig: AppConfigContract["database"]): PoolConfig {
	const baseConfig: PoolConfig = {
		max: dbConfig.poolMax,
		idleTimeoutMillis: dbConfig.idleTimeoutMs,
		connectionTimeoutMillis: dbConfig.connectionTimeoutMs,
		statement_timeout: dbConfig.statementTimeoutMs,
	};

	return {
		...baseConfig,
		connectionString:
			dbConfig.connectionString ?? "postgresql://postgres:password@localhost:5432/postgres",
	};
}

const pool = new Pool(createPoolConfig(appConfig.database));

const queryLogger = {
	logQuery(query: string, _params: unknown[]) {
		if (appConfig.isDevelopment) {
			getLogger().debug({ query: query.slice(0, 200) }, "DB query");
		}
	},
};

export const db = drizzle({
	client: pool,
	relations,
	logger: queryLogger,
});
export { pool };

/**
 * Run database migrations programmatically.
 * Call this on app startup in production.
 */
export async function runMigrations(): Promise<void> {
	getLogger().info("Running database migrations");
	await migrate(db, { migrationsFolder: "./drizzle" });
	getLogger().info("Database migrations completed");
}
