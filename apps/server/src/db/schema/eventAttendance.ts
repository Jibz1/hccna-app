import {
	boolean,
	date,
	index,
	integer,
	pgTable,
	primaryKey,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";

export const eventAttendanceSummaries = pgTable(
	"event_attendance_summaries",
	{
		id: varchar("id", { length: 64 })
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: varchar("event_id", { length: 64 }).notNull(),
		occurrenceDate: date("occurrence_date").notNull(),
		ccbGroupId: varchar("ccb_group_id", { length: 64 }).notNull(),
		eventName: varchar("event_name", { length: 255 }).notNull(),
		attendeesCount: integer("attendees_count").notNull(),
		topic: varchar("topic", { length: 500 }),
		notes: varchar("notes", { length: 2000 }),
		lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
		isStale: boolean("is_stale").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex("event_attendance_summaries_event_occurrence_idx").on(
			table.ccbGroupId,
			table.eventId,
			table.occurrenceDate,
		),
		index("event_attendance_summaries_group_occurrence_idx").on(
			table.ccbGroupId,
			table.occurrenceDate,
		),
		index("event_attendance_summaries_last_synced_idx").on(table.lastSyncedAt),
	],
);

export const eventAttendanceEntries = pgTable(
	"event_attendance_entries",
	{
		ccbGroupId: varchar("ccb_group_id", { length: 64 }).notNull(),
		eventId: varchar("event_id", { length: 64 }).notNull(),
		occurrenceDate: date("occurrence_date").notNull(),
		attendeeCcbId: varchar("attendee_ccb_id", { length: 64 }).notNull(),
		attendeeName: varchar("attendee_name", { length: 255 }),
		attended: boolean("attended").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		primaryKey({
			name: "event_attendance_entries_event_occurrence_attendee_pk",
			columns: [table.ccbGroupId, table.eventId, table.occurrenceDate, table.attendeeCcbId],
		}),
		index("event_attendance_entries_attendee_occurrence_idx").on(
			table.attendeeCcbId,
			table.ccbGroupId,
			table.occurrenceDate,
		),
		index("event_attendance_entries_event_occurrence_attended_idx").on(
			table.ccbGroupId,
			table.eventId,
			table.occurrenceDate,
			table.attended,
		),
	],
);
