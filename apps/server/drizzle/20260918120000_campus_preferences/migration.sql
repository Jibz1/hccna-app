ALTER TABLE "app_users" ADD COLUMN "preferred_campus_slug" text;
ALTER TABLE "app_users" ADD COLUMN "campus_preference_version" integer DEFAULT 0 NOT NULL;
CREATE TABLE "campus_subscription_sync" (
  "user_id" text PRIMARY KEY REFERENCES "app_users"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "campus_subscription_sync_due_idx" ON "campus_subscription_sync" ("next_attempt_at");
