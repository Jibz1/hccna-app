import { SAVED_VERSE_LIMIT } from "@/effect/services/savedVerses/model";
import { makeSavedVerseStore, SavedVerseStore } from "@/effect/services/SavedVerseStore";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import { Layer } from "effect";
import { readFile } from "node:fs/promises";

const MIGRATION = new URL(
	"../../../../drizzle/20261001120000_saved_verses/migration.sql",
	import.meta.url,
);

// Only the app_users columns saved_verses depends on; the real table has more.
const APP_USERS = `
	CREATE TABLE "app_users" (
		"id" text PRIMARY KEY,
		"firebase_uid" varchar(128) NOT NULL UNIQUE,
		"email" varchar(255) NOT NULL UNIQUE
	);
`;

const SEED_USERS = `INSERT INTO "app_users" ("id", "firebase_uid", "email") VALUES
		('user-a', 'uid-a', 'a@example.com'),
		('user-b', 'uid-b', 'b@example.com');
`;

/** In-memory Postgres with the real saved_verses migration, and a store layer backed by it. */
async function createSavedVersesTestDb() {
	const client = new PGlite();
	await client.exec(APP_USERS);
	await client.exec(await readFile(MIGRATION, "utf8"));
	const storeLayer = Layer.succeed(SavedVerseStore, makeSavedVerseStore(drizzle({ client })));
	const fillSaves = (userId: string, count = SAVED_VERSE_LIMIT) =>
		client.query(
			`INSERT INTO saved_verses (user_id, verse_id, kind)
			 SELECT $1, 'bulk-' || n, 'verse-of-the-day' FROM generate_series(1, $2) AS n`,
			[userId, count],
		);
	return { client, storeLayer, fillSaves };
}

/** Boot Postgres once per suite; preserve test isolation by resetting all fixture rows. */
export function useSavedVersesTestDb() {
	let database: Awaited<ReturnType<typeof createSavedVersesTestDb>> | null = null;
	const getDatabase = () => {
		if (!database) {
			throw new Error("Saved verses test database has not been initialized");
		}
		return database;
	};
	// WASM initialization competes with builds on CI; query tests keep their normal timeout.
	beforeAll(async () => {
		database = await createSavedVersesTestDb();
	}, 30_000);
	beforeEach(async () => {
		await getDatabase().client.exec(`TRUNCATE app_users CASCADE; ${SEED_USERS}`);
	});
	afterAll(async () => {
		await database?.client.close();
	});
	return getDatabase;
}
