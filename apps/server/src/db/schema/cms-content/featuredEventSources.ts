import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export interface FeaturedEventSourceItem {
	sourceId: number | null;
	allCampusEvent: boolean;
	eventTitle: string;
	description: string;
	eventImageUrl: string;
	pageLink: string | null;
	slug: string | null;
	prominentColorDark: string | null;
	prominentColorLight: string | null;
	prominentColorAccent: string | null;
}

// Array order is the CMS editorial order. Null means not loaded; [] is a
// successfully loaded empty source. Legacy merged campus rows are never imported.
export const featuredEventSources = pgTable("featured_event_sources", {
	source: text("source").primaryKey(),
	events: jsonb("events").$type<FeaturedEventSourceItem[]>(),
	contentRevision: integer("content_revision").default(0).notNull(),
	revision: integer("revision").default(0).notNull(),
	attemptedAt: timestamp("attempted_at", { withTimezone: true }),
	syncedAt: timestamp("synced_at", { withTimezone: true }),
});
