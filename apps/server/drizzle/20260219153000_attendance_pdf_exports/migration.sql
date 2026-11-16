CREATE TABLE "event_attendance_summaries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"occurrence_date" date NOT NULL,
	"ccb_group_id" varchar(64) NOT NULL,
	"event_name" varchar(255) NOT NULL,
	"attendees_count" integer NOT NULL,
	"topic" varchar(500),
	"notes" varchar(2000),
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "event_attendance_entries" (
	"ccb_group_id" varchar(64) NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"occurrence_date" date NOT NULL,
	"attendee_ccb_id" varchar(64) NOT NULL,
	"attendee_name" varchar(255),
	"attended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_attendance_entries_event_occurrence_attendee_pk" PRIMARY KEY("ccb_group_id","event_id","occurrence_date","attendee_ccb_id")
);

CREATE TABLE "attendance_pdf_exports" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"export_key" varchar(255) NOT NULL,
	"query_type" varchar(32) NOT NULL,
	"request_fingerprint" varchar(2000) NOT NULL,
	"data_hash" varchar(64) NOT NULL,
	"gcs_bucket" varchar(128) DEFAULT 'app-hccnj' NOT NULL,
	"gcs_object_path" varchar(1024) NOT NULL,
	"public_url" varchar(2048) NOT NULL,
	"last_generated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "event_attendance_summaries_event_occurrence_idx" ON "event_attendance_summaries" USING btree ("ccb_group_id","event_id","occurrence_date");
CREATE INDEX "event_attendance_summaries_group_occurrence_idx" ON "event_attendance_summaries" USING btree ("ccb_group_id","occurrence_date");
CREATE INDEX "event_attendance_summaries_last_synced_idx" ON "event_attendance_summaries" USING btree ("last_synced_at");

CREATE INDEX "event_attendance_entries_attendee_occurrence_idx" ON "event_attendance_entries" USING btree ("attendee_ccb_id","ccb_group_id","occurrence_date");
CREATE INDEX "event_attendance_entries_event_occurrence_attended_idx" ON "event_attendance_entries" USING btree ("ccb_group_id","event_id","occurrence_date","attended");

CREATE UNIQUE INDEX "attendance_pdf_exports_export_key_idx" ON "attendance_pdf_exports" USING btree ("export_key");
CREATE INDEX "attendance_pdf_exports_query_type_updated_idx" ON "attendance_pdf_exports" USING btree ("query_type","updated_at");
CREATE INDEX "attendance_pdf_exports_data_hash_idx" ON "attendance_pdf_exports" USING btree ("data_hash");
