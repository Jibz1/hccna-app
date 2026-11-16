CREATE TYPE "public"."donation_sync_status" AS ENUM('SUCCESS', 'FAILED', 'PARTIAL');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ministries" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	CONSTRAINT "ministries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"firebase_uid" varchar(128) NOT NULL,
	"email" varchar(255) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"phone" varchar(20),
	"img" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"ccb_id" varchar(50),
	"ccb_family_id" varchar(50),
	"provider" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "app_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_departments" (
	"user_id" text NOT NULL,
	"department_id" text NOT NULL,
	CONSTRAINT "user_departments_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "user_ministries" (
	"user_id" text NOT NULL,
	"ministry_id" text NOT NULL,
	CONSTRAINT "user_ministries_user_id_ministry_id_pk" PRIMARY KEY("user_id","ministry_id")
);
--> statement-breakpoint
CREATE TABLE "daily_verses" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"scripture_id" text NOT NULL,
	"image" text,
	CONSTRAINT "daily_verses_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "scriptures" (
	"id" text PRIMARY KEY NOT NULL,
	"book" varchar(100) NOT NULL,
	"st_book" varchar(20) NOT NULL,
	"verse_id" varchar(100) NOT NULL,
	"text" text NOT NULL,
	"nlt_translation" text NOT NULL,
	"images" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scriptures_verse_id_unique" UNIQUE("verse_id")
);
--> statement-breakpoint
CREATE TABLE "word_activation_subs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scripture_id" text NOT NULL,
	"monthly_sub" boolean DEFAULT false NOT NULL,
	"last_update" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "word_activation_subs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "donation_sync_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"transaction_count" integer NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"sync_status" "donation_sync_status" NOT NULL,
	"error_message" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "donation_yearly_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"number_of_donations" integer NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ccb_transaction_id" varchar(100) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"date" date NOT NULL,
	"year" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"campus" varchar(255),
	"campus_id" varchar(50),
	"payment_type" varchar(50),
	"tax_deductible" boolean DEFAULT true NOT NULL,
	"synced_from_ccb_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ministries" ADD CONSTRAINT "user_ministries_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ministries" ADD CONSTRAINT "user_ministries_ministry_id_ministries_id_fk" FOREIGN KEY ("ministry_id") REFERENCES "public"."ministries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_verses" ADD CONSTRAINT "daily_verses_scripture_id_scriptures_id_fk" FOREIGN KEY ("scripture_id") REFERENCES "public"."scriptures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_activation_subs" ADD CONSTRAINT "word_activation_subs_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_activation_subs" ADD CONSTRAINT "word_activation_subs_scripture_id_scriptures_id_fk" FOREIGN KEY ("scripture_id") REFERENCES "public"."scriptures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_sync_logs" ADD CONSTRAINT "donation_sync_logs_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_yearly_summaries" ADD CONSTRAINT "donation_yearly_summaries_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "app_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_firebase_uid_idx" ON "app_users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "users_ccb_id_idx" ON "app_users" USING btree ("ccb_id");--> statement-breakpoint
CREATE INDEX "users_ccb_family_id_idx" ON "app_users" USING btree ("ccb_family_id");--> statement-breakpoint
CREATE INDEX "daily_verses_date_idx" ON "daily_verses" USING btree ("date");--> statement-breakpoint
CREATE INDEX "scriptures_book_idx" ON "scriptures" USING btree ("book");--> statement-breakpoint
CREATE INDEX "word_activation_subs_user_id_idx" ON "word_activation_subs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "donation_sync_logs_user_year_synced_idx" ON "donation_sync_logs" USING btree ("user_id","year","synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "donation_summaries_user_year_idx" ON "donation_yearly_summaries" USING btree ("user_id","year");--> statement-breakpoint
CREATE INDEX "donation_summaries_last_synced_idx" ON "donation_yearly_summaries" USING btree ("last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "donations_user_transaction_idx" ON "donations" USING btree ("user_id","ccb_transaction_id");--> statement-breakpoint
CREATE INDEX "donations_user_year_idx" ON "donations" USING btree ("user_id","year");--> statement-breakpoint
CREATE INDEX "donations_user_date_idx" ON "donations" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "donations_ccb_transaction_id_idx" ON "donations" USING btree ("ccb_transaction_id");