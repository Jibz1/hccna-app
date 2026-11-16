import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════
// FEATURED EVENTS TABLE
// ═══════════════════════════════════════════════════════════════

export const featuredEvents = pgTable(
	"featured_events",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		campusSlug: text("campus_slug"),
		eventTitle: text("event_title").notNull(),
		description: text("description").notNull(),
		eventImageUrl: text("event_image_url").notNull(),
		pageLink: text("page_link"),
		prominentColorDark: text("prominent_color_dark"),
		prominentColorLight: text("prominent_color_light"),
		prominentColorAccent: text("prominent_color_accent"),
		slug: text("slug"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [index("featured_events_campus_slug_idx").on(table.campusSlug)],
);

export const upComingEvents = pgTable("up_coming_events", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	description: text("description").notNull(),
	eventDate: timestamp("event_date").notNull(),
	eventMonth: text("event_month").notNull(),
	eventTime: text("event_time").notNull(),
	eventTitle: text("event_title").notNull(),
	image: text("image").notNull(),
	reoccurring: text("reoccurring").notNull(),
	slug: text("slug").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
});
