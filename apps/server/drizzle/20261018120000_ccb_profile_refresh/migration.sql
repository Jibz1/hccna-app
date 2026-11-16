ALTER TABLE "app_users" ADD COLUMN "ccb_profile_checked_at" timestamp with time zone;
--> statement-breakpoint
-- Spread the first weekly check of existing complete profiles across the next six days,
-- so the first app opens after release do not all queue CCB lookups at once. Pending and
-- placeholder-name profiles stay NULL and are due at once, as their repairs were before.
UPDATE "app_users"
SET "ccb_profile_checked_at" = now() - random() * interval '6 days'
WHERE "enrichment_pending" = false
	AND COALESCE("first_name", '') NOT IN ('Hi', 'There', 'Anonymous')
	AND COALESCE("last_name", '') NOT IN ('Hi', 'There', 'Anonymous');
