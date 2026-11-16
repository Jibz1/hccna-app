import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════
// CORE SETTINGS TABLE
// ═══════════════════════════════════════════════════════════════

export const coreSettings = pgTable("core_settings", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),

	// Giving section
	givingFeatureImage: text("giving_feature_image"),
	givingCopy: text("giving_copy"),

	// Profile section
	profileFeatureImage: text("profile_feature_image"),
	profileCopy: text("profile_copy"),

	// Sermons section
	sermonsFeatureImage: text("sermons_feature_image"),
	sermonsCopy: text("sermons_copy"),

	// HCC Expression section
	hccExpressionFeatureImage: text("hcc_expression_feature_image"),
	hccExpressionCopy: text("hcc_expression_copy"),

	// Events section
	eventsFeatureImage: text("events_feature_image"),
	eventsCopy: text("events_copy"),

	// More section
	moreFeatureImage: text("more_feature_image"),
	moreCopy: text("more_copy"),

	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
});
