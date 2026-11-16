import { boolean, date, index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { users } from "./users";

// ═══════════════════════════════════════════════════════════════
// SCRIPTURES TABLE (Word of Activation verses)
// ═══════════════════════════════════════════════════════════════

export const scriptures = pgTable(
	"scriptures",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		book: varchar("book", { length: 100 }).notNull(),
		stBook: varchar("st_book", { length: 20 }).notNull(),
		verseId: varchar("verse_id", { length: 100 }).notNull().unique(), // e.g., "John 3:16"
		text: text("text").notNull(),
		nltTranslation: text("nlt_translation").notNull(),
		images: text("images").array(), // Array of image URLs
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("scriptures_book_idx").on(table.book)],
);

// ═══════════════════════════════════════════════════════════════
// WORD ACTIVATION SUBSCRIPTIONS TABLE
// ═══════════════════════════════════════════════════════════════

export const wordActivationSubs = pgTable(
	"word_activation_subs",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.unique()
			.references(() => users.id, { onDelete: "cascade" }),
		scriptureId: text("scripture_id")
			.notNull()
			.references(() => scriptures.id),
		monthlySub: boolean("monthly_sub").default(false).notNull(),
		lastUpdate: timestamp("last_update").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("word_activation_subs_user_id_idx").on(table.userId)],
);

// ═══════════════════════════════════════════════════════════════
// DAILY VERSES TABLE (Verse of the Day cache)
// ═══════════════════════════════════════════════════════════════

export const dailyVerses = pgTable(
	"daily_verses",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		date: date("date").notNull().unique(),
		scriptureId: text("scripture_id")
			.notNull()
			.references(() => scriptures.id),
		image: text("image"),
	},
	(table) => [index("daily_verses_date_idx").on(table.date)],
);
