CREATE TABLE "saved_verses" (
  "user_id" text NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
  "verse_id" text NOT NULL,
  "kind" text NOT NULL,
  "saved_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saved_verses_pkey" PRIMARY KEY ("user_id", "verse_id"),
  CONSTRAINT "saved_verses_kind_check" CHECK ("kind" IN ('verse-of-the-day', 'word-of-activation'))
);
