import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";

const DRIZZLE_DIR = new URL("../../../../drizzle/", import.meta.url);
const BASE_MIGRATION = new URL("20260120233017_boring_rawhide_kid/migration.sql", DRIZZLE_DIR);
const SUMMARY_CCB_ID_MIGRATION = new URL(
	"20261015120000_donation_summary_ccb_id/migration.sql",
	DRIZZLE_DIR,
);

// Only the app_users column the donation tables reference; the real table has more.
const APP_USERS = `CREATE TABLE "app_users" ("id" text PRIMARY KEY);`;

const SEED_USERS = `INSERT INTO "app_users" ("id") VALUES ('user-a'), ('user-b');`;

/** In-memory Postgres with the real donation tables, as the migrations create them. */
async function createGivingTestDb() {
	const client = new PGlite();
	await client.exec(APP_USERS);
	// The first migration creates every table; keep the donation statements only.
	const baseMigration = await readFile(BASE_MIGRATION, "utf8");
	const donationStatements = baseMigration
		.split("--> statement-breakpoint")
		.filter((statement) => statement.includes('"donation'));
	await client.exec(donationStatements.join(";\n"));
	await client.exec(await readFile(SUMMARY_CCB_ID_MIGRATION, "utf8"));
	return { client, db: drizzle({ client }) };
}

/** Boot Postgres once per suite; reset every row before each test. */
export function useGivingTestDb() {
	let database: Awaited<ReturnType<typeof createGivingTestDb>> | null = null;
	const getDatabase = () => {
		if (!database) {
			throw new Error("Giving test database has not been initialized");
		}
		return database;
	};
	// WASM initialization competes with builds on CI; query tests keep their normal timeout.
	beforeAll(async () => {
		database = await createGivingTestDb();
	}, 30_000);
	beforeEach(async () => {
		await getDatabase().client.exec(`TRUNCATE app_users CASCADE; ${SEED_USERS}`);
	});
	afterAll(async () => {
		await database?.client.close();
	});
	return getDatabase;
}
