import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./users";

/** Where a verse was first saved from; also labels the saved card in clients. */
export const SAVED_VERSE_KINDS = ["verse-of-the-day", "word-of-activation"] as const;
export type SavedVerseKind = (typeof SAVED_VERSE_KINDS)[number];

// ═══════════════════════════════════════════════════════════════
// SAVED VERSES TABLE (scripture a user saved to their account)
// ═══════════════════════════════════════════════════════════════

export const savedVerses = pgTable(
	"saved_verses",
	{
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		// Scripture catalog key: the `wordActivationScriptures` document ID. The catalog lives
		// outside Postgres, so this is deliberately not a foreign key.
		verseId: text("verse_id").notNull(),
		kind: text("kind", { enum: SAVED_VERSE_KINDS }).notNull(),
		savedAt: timestamp("saved_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ name: "saved_verses_pkey", columns: [table.userId, table.verseId] }),
		check(
			"saved_verses_kind_check",
			sql`${table.kind} IN ('verse-of-the-day', 'word-of-activation')`,
		),
	],
);
