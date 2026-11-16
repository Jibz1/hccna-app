import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";

const MIGRATION = new URL(
	"../../../../../drizzle/20260927120000_featured_event_sources/migration.sql",
	import.meta.url,
);

/** In-memory Postgres with the real featured_event_sources table and its seeded home source. */
export async function createFeaturedEventSourcesTestDb() {
	const client = new PGlite();
	// The migration's backfill reads a legacy table these tests do not need.
	const [createTable, seedHome] = (await readFile(MIGRATION, "utf8")).split(
		"--> statement-breakpoint",
	);
	await client.exec(`${createTable}${seedHome}`);
	return { db: drizzle({ client }), close: () => client.close() };
}
