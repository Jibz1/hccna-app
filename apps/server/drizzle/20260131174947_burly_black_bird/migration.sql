CREATE TABLE "up_coming_events" (
	"id" text PRIMARY KEY,
	"description" text NOT NULL,
	"event_date" timestamp NOT NULL,
	"event_month" text NOT NULL,
	"event_time" text NOT NULL,
	"event_title" text NOT NULL,
	"image" text NOT NULL,
	"reoccurring" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
