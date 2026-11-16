import { featuredEventSources } from "@/db/schema";
import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { makeFeaturedEventFeeds } from "@/effect/services/cms/featuredEventFeeds";
import * as prominentColors from "@/effect/services/cms/prominentColors";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { configureResponseCache } from "@/graphql/responseCache";
import { createInMemoryCache } from "@graphql-yoga/plugin-response-cache";
import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Effect, Layer } from "effect";

import { createFeaturedEventSourcesTestDb } from "./featuredEventSourcesTestDb";

import type { CmsFeaturedCard } from "@hccnj/strapi-v2";

const PROMINENT_COLORS = {
	prominentColorDark: "#111111",
	prominentColorLight: "#eeeeee",
	prominentColorAccent: "#ff0000",
};

// A spy, unlike mock.module, is restored after this file, so it cannot leak into other suites.
// Bun evaluates each test file just before running its tests, so the spy exists only for them.
const extractProminentColorsFromImageUrl = spyOn(
	prominentColors,
	"extractProminentColorsFromImageUrl",
).mockResolvedValue(PROMINENT_COLORS);

const card = (name: string, image: string): CmsFeaturedCard => ({
	sourceId: 1,
	eventTitle: name,
	description: `${name} description`,
	imageUrl: image,
	pageLink: null,
	allCampusEvent: false,
});

const invalidations: unknown[] = [];

async function createFeeds(cards: readonly CmsFeaturedCard[]) {
	const { db, close } = await createFeaturedEventSourcesTestDb();
	const layer = Layer.mergeAll(
		Layer.succeed(DrizzleService, { db } as never),
		Layer.succeed(CmsContent, { homeFeaturedCards: Effect.succeed(cards) } as never),
	);
	const feeds = await Effect.runPromise(makeFeaturedEventFeeds.pipe(Effect.provide(layer)));
	const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
	const storedEvents = async () => {
		const [row] = await db.select().from(featuredEventSources);
		return row?.events ?? null;
	};
	return { feeds, run, storedEvents, close };
}

beforeEach(() => {
	extractProminentColorsFromImageUrl.mockClear();
	invalidations.length = 0;
	configureResponseCache({
		...createInMemoryCache({ max: 500 }),
		invalidate: (entities) => {
			invalidations.push(entities);
			return Promise.resolve();
		},
	});
});

afterAll(() => {
	extractProminentColorsFromImageUrl.mockRestore();
	// Leave a working cache, like the module default. Never install a copy of the exported
	// `responseCache`: it delegates to the active cache, so it would call itself forever.
	configureResponseCache(createInMemoryCache({ max: 500 }));
});

describe("FeaturedEventFeeds.refresh", () => {
	it("stores prominent colours for new events as part of the refresh", async () => {
		const { feeds, run, storedEvents, close } = await createFeeds([
			card("Night of Worship", "https://cdn.example.com/worship.jpg"),
		]);

		await run(feeds.refresh("home"));

		expect(extractProminentColorsFromImageUrl).toHaveBeenCalledTimes(1);
		expect(extractProminentColorsFromImageUrl).toHaveBeenCalledWith(
			"https://cdn.example.com/worship.jpg",
		);
		expect(await storedEvents()).toEqual([
			expect.objectContaining({
				eventTitle: "Night of Worship",
				prominentColorDark: "#111111",
				prominentColorLight: "#eeeeee",
				prominentColorAccent: "#ff0000",
			}),
		]);
		expect(invalidations).toHaveLength(1);
		await close();
	});

	it("keeps stored colours instead of re-extracting unchanged images", async () => {
		const { feeds, run, storedEvents, close } = await createFeeds([
			card("Night of Worship", "https://cdn.example.com/worship.jpg"),
		]);
		await run(feeds.refresh("home"));

		await run(feeds.refresh("home", true));

		expect(extractProminentColorsFromImageUrl).toHaveBeenCalledTimes(1);
		expect(await storedEvents()).toEqual([
			expect.objectContaining({ prominentColorAccent: "#ff0000" }),
		]);
		// Nothing changed on the second refresh, so readers keep their cache.
		expect(invalidations).toHaveLength(1);
		await close();
	});

	it("saves the event without colours when extraction fails", async () => {
		extractProminentColorsFromImageUrl.mockRejectedValueOnce(new Error("decode failed"));
		const { feeds, run, storedEvents, close } = await createFeeds([
			card("Night of Worship", "https://cdn.example.com/broken.jpg"),
		]);

		await run(feeds.refresh("home"));

		expect(await storedEvents()).toEqual([
			expect.objectContaining({
				eventTitle: "Night of Worship",
				prominentColorDark: null,
				prominentColorLight: null,
				prominentColorAccent: null,
			}),
		]);
		await close();
	});
});
