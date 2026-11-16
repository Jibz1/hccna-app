import { coreSettings } from "@/db/schema";
import { CORE_SETTINGS_ID, FALLBACK_IMAGE } from "@/effect/services/cms/constants";
import { upsertCoreSettings } from "@/effect/services/cms/repositories";
import { coreSettingsColumns } from "@/effect/services/cms/transforms";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "effect";
import { readFile } from "node:fs/promises";

// The migration that creates core_settings; no later migration alters the table.
const CORE_SETTINGS_MIGRATION = new URL(
	"../../../../../drizzle/20260124024341_clean_catseye/migration.sql",
	import.meta.url,
);

const STORED = {
	id: CORE_SETTINGS_ID,
	givingFeatureImage: "https://stored.example.com/giving.jpg",
	givingCopy: "Stored giving",
	profileFeatureImage: "https://stored.example.com/profile.jpg",
	profileCopy: "Stored profile",
	sermonsFeatureImage: "https://stored.example.com/sermons.jpg",
	sermonsCopy: "Stored sermons",
	hccExpressionFeatureImage: "https://stored.example.com/hcc-expression.jpg",
	hccExpressionCopy: "Stored HCC expression",
	eventsFeatureImage: "https://stored.example.com/events.jpg",
	eventsCopy: "Stored events",
	moreFeatureImage: "https://stored.example.com/more.jpg",
	moreCopy: "Stored more",
};

describe("upsertCoreSettings", () => {
	it("keeps the stored copy and image of every section the CMS does not provide", async () => {
		const client = new PGlite();
		try {
			await client.exec(await readFile(CORE_SETTINGS_MIGRATION, "utf8"));
			const db = drizzle({ client });
			await db.insert(coreSettings).values(STORED);

			// Strapi 5 has no profile, sermons or events section, so those six columns are undefined.
			const columns = coreSettingsColumns({
				giving: { copy: "New giving", image: "https://new.example.com/giving.jpg" },
				hccexpression: { copy: "New HCC expression", image: null },
				more: { copy: null, image: "https://new.example.com/more.jpg" },
			});
			await Effect.runPromise(
				upsertCoreSettings(columns).pipe(Effect.provideService(DrizzleService, { db } as never)),
			);

			const [row] = await db.select().from(coreSettings);
			expect(row).toMatchObject({
				id: CORE_SETTINGS_ID,
				profileCopy: STORED.profileCopy,
				profileFeatureImage: STORED.profileFeatureImage,
				sermonsCopy: STORED.sermonsCopy,
				sermonsFeatureImage: STORED.sermonsFeatureImage,
				eventsCopy: STORED.eventsCopy,
				eventsFeatureImage: STORED.eventsFeatureImage,
				// A provided section is written whole: a null copy as NULL, a missing image as the fallback.
				givingCopy: "New giving",
				givingFeatureImage: "https://new.example.com/giving.jpg",
				hccExpressionCopy: "New HCC expression",
				hccExpressionFeatureImage: FALLBACK_IMAGE,
				moreCopy: null,
				moreFeatureImage: "https://new.example.com/more.jpg",
			});
		} finally {
			await client.close();
		}
	});
});
