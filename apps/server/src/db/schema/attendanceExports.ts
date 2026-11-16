import { index, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const attendancePdfExports = pgTable(
	"attendance_pdf_exports",
	{
		id: varchar("id", { length: 64 })
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		exportKey: varchar("export_key", { length: 255 }).notNull(),
		queryType: varchar("query_type", { length: 32 }).notNull(),
		requestFingerprint: varchar("request_fingerprint", {
			length: 2000,
		}).notNull(),
		dataHash: varchar("data_hash", { length: 64 }).notNull(),
		gcsBucket: varchar("gcs_bucket", { length: 128 }).notNull().default("app-hccnj"),
		gcsObjectPath: varchar("gcs_object_path", { length: 1024 }).notNull(),
		downloadTokenHash: varchar("download_token_hash", { length: 64 }),
		publicUrl: varchar("public_url", { length: 2048 }).notNull(),
		lastGeneratedAt: timestamp("last_generated_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex("attendance_pdf_exports_export_key_idx").on(table.exportKey),
		index("attendance_pdf_exports_query_type_updated_idx").on(table.queryType, table.updatedAt),
		index("attendance_pdf_exports_data_hash_idx").on(table.dataHash),
	],
);
