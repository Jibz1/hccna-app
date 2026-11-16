CREATE TABLE "featured_event_sources" (
  "source" text PRIMARY KEY NOT NULL,
  "events" jsonb,
  "content_revision" integer DEFAULT 0 NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "attempted_at" timestamp with time zone,
  "synced_at" timestamp with time zone
);
--> statement-breakpoint
-- Seed source identities, never the old campus lists: those contain copies of
-- shared cards that cannot be distinguished from local cards. The worker and
-- first read rebuild each snapshot from published Strapi content.
INSERT INTO "featured_event_sources" ("source") VALUES ('home');
--> statement-breakpoint
INSERT INTO "featured_event_sources" ("source")
SELECT DISTINCT 'campus:' || "campus_slug" FROM "featured_events"
WHERE "campus_slug" IS NOT NULL AND "campus_slug" <> ''
ON CONFLICT DO NOTHING;
