ALTER TABLE "featured_events" ADD COLUMN "campus_slug" text;
CREATE INDEX "featured_events_campus_slug_idx" ON "featured_events" ("campus_slug");
