import { boolean, index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════
// USERS TABLE
// ═══════════════════════════════════════════════════════════════

export const users = pgTable(
	"app_users",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		firebaseUid: varchar("firebase_uid", { length: 128 }).notNull().unique(),
		email: varchar("email", { length: 255 }).notNull().unique(),
		firstName: varchar("first_name", { length: 100 }),
		lastName: varchar("last_name", { length: 100 }),
		phone: varchar("phone", { length: 20 }),
		img: text("img"),
		isVerified: boolean("is_verified").default(false).notNull(),
		enrichmentPending: boolean("enrichment_pending").default(false).notNull(),
		ccbProfileCheckedAt: timestamp("ccb_profile_checked_at", { withTimezone: true }),
		ccbId: varchar("ccb_id", { length: 50 }),
		ccbFamilyId: varchar("ccb_family_id", { length: 50 }),
		provider: varchar("provider", { length: 50 }),
		preferredCampusSlug: text("preferred_campus_slug"),
		campusPreferenceVersion: integer("campus_preference_version").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("users_email_idx").on(table.email),
		index("users_firebase_uid_idx").on(table.firebaseUid),
		index("users_ccb_id_idx").on(table.ccbId),
		index("users_ccb_family_id_idx").on(table.ccbFamilyId),
	],
);

export const campusSubscriptionSync = pgTable(
	"campus_subscription_sync",
	{
		userId: text("user_id")
			.primaryKey()
			.references(() => users.id, { onDelete: "cascade" }),
		version: integer("version").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("campus_subscription_sync_due_idx").on(table.nextAttemptAt)],
);

// ═══════════════════════════════════════════════════════════════
// DEPARTMENTS TABLE
// ═══════════════════════════════════════════════════════════════

export const departments = pgTable("departments", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: varchar("name", { length: 255 }).notNull().unique(),
});

// ═══════════════════════════════════════════════════════════════
// MINISTRIES TABLE
// ═══════════════════════════════════════════════════════════════

export const ministries = pgTable("ministries", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: varchar("name", { length: 255 }).notNull().unique(),
});
