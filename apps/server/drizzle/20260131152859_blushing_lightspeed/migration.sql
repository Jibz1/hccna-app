CREATE TABLE "featured_events" (
	"id" text PRIMARY KEY,
	"event_title" text NOT NULL,
	"description" text NOT NULL,
	"event_image_url" text NOT NULL,
	"page_link" text,
	"slug" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
