import {
	boolean,
	date,
	index,
	integer,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";

// ═══════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════

export const donationSyncStatusEnum = pgEnum("donation_sync_status", [
	"SUCCESS",
	"FAILED",
	"PARTIAL",
]);

// ═══════════════════════════════════════════════════════════════
// DONATIONS TABLE (CCB cached transactions)
// ═══════════════════════════════════════════════════════════════

export const donations = pgTable(
	"donations",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		ccbTransactionId: varchar("ccb_transaction_id", { length: 100 }).notNull(),
		amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
		date: date("date").notNull(),
		year: integer("year").notNull(),
		name: varchar("name", { length: 255 }).notNull(), // COA name (Chart of Accounts)
		campus: varchar("campus", { length: 255 }),
		campusId: varchar("campus_id", { length: 50 }),
		paymentType: varchar("payment_type", { length: 50 }),
		taxDeductible: boolean("tax_deductible").default(true).notNull(),

		// Sync metadata
		syncedFromCcbAt: timestamp("synced_from_ccb_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex("donations_user_transaction_idx").on(table.userId, table.ccbTransactionId),
		index("donations_user_year_idx").on(table.userId, table.year),
		index("donations_user_date_idx").on(table.userId, table.date),
		index("donations_ccb_transaction_id_idx").on(table.ccbTransactionId),
	],
);

// ═══════════════════════════════════════════════════════════════
// DONATION YEARLY SUMMARIES TABLE (Aggregated cache)
// ═══════════════════════════════════════════════════════════════

export const donationYearlySummaries = pgTable(
	"donation_yearly_summaries",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		year: integer("year").notNull(),
		// CCB individual the rows were fetched for; a summary for another (or no) id is a cache miss.
		ccbId: varchar("ccb_id", { length: 50 }),
		totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
		numberOfDonations: integer("number_of_donations").notNull(),

		// Cache control
		lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
		isStale: boolean("is_stale").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex("donation_summaries_user_year_idx").on(table.userId, table.year),
		index("donation_summaries_last_synced_idx").on(table.lastSyncedAt),
	],
);

// ═══════════════════════════════════════════════════════════════
// DONATION SYNC LOGS TABLE (Audit trail)
// ═══════════════════════════════════════════════════════════════

export const donationSyncLogs = pgTable(
	"donation_sync_logs",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		year: integer("year").notNull(),
		syncedAt: timestamp("synced_at").defaultNow().notNull(),
		transactionCount: integer("transaction_count").notNull(),
		totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
		syncStatus: donationSyncStatusEnum("sync_status").notNull(),
		errorMessage: text("error_message"),
		durationMs: integer("duration_ms"),
	},
	(table) => [
		index("donation_sync_logs_user_year_synced_idx").on(table.userId, table.year, table.syncedAt),
	],
);
