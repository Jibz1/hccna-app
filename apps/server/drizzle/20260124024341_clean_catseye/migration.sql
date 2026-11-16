CREATE TABLE "core_settings" (
	"id" text PRIMARY KEY,
	"giving_feature_image" text,
	"giving_copy" text,
	"profile_feature_image" text,
	"profile_copy" text,
	"sermons_feature_image" text,
	"sermons_copy" text,
	"hcc_expression_feature_image" text,
	"hcc_expression_copy" text,
	"events_feature_image" text,
	"events_copy" text,
	"more_feature_image" text,
	"more_copy" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
