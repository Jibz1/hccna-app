import { FALLBACK_IMAGE } from "@/effect/services/cms/constants";
import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import {
	campusFeaturedSource,
	HOME_FEATURED_SOURCE,
	makeFeaturedEventRepository,
} from "@/effect/services/cms/featuredEventRepository";
import { extractProminentColorsFromImageUrl } from "@/effect/services/cms/prominentColors";
import { featuredEventSlug, transformDbFeaturedEvents } from "@/effect/services/cms/transforms";
import { CMSFetchError } from "@/effect/services/CMSErrors";
import { responseCache } from "@/graphql/responseCache";
import { CampusSlugSchema } from "@/utils/campuses";
import { DateTime, Effect, Schema } from "effect";
import { isDeepStrictEqual } from "node:util";

import type { FeaturedEventSourceItem } from "@/db/schema";

const needsColors = (event: FeaturedEventSourceItem) =>
	!event.prominentColorDark || !event.prominentColorLight || !event.prominentColorAccent;

export const makeFeaturedEventFeeds = Effect.gen(function* () {
	const repository = yield* makeFeaturedEventRepository;
	const content = yield* CmsContent;
	const invalidateFeeds = Effect.tryPromise(async () => {
		await responseCache.invalidate([
			{ typename: "Home" },
			{ typename: "FeaturedEventsSuccess" },
			{ typename: "FeaturedEventsFetchError" },
			{ typename: "FeaturedEventsNotFoundError" },
		]);
	}).pipe(
		Effect.catch((error) =>
			Effect.logWarning("Featured event cache invalidation failed", { error }),
		),
	);

	const fetchCards = Effect.fn("FeaturedEventFeeds.fetchCards")(
		function* (source: string) {
			if (source === HOME_FEATURED_SOURCE) {
				return (yield* content.homeFeaturedCards) ?? [];
			}
			return yield* content.campusFeaturedCards(source.slice("campus:".length));
		},
		Effect.mapError(
			(cause) => new CMSFetchError({ detail: "Failed to fetch published featured events", cause }),
		),
	);

	// Colours are extracted while the snapshot is being rebuilt, so the only
	// request that pays for image decoding is the one that finds new images.
	const withProminentColors = Effect.fn("FeaturedEventFeeds.withProminentColors")(function* (
		source: string,
		events: FeaturedEventSourceItem[],
	) {
		return yield* Effect.forEach(
			events,
			(event) =>
				needsColors(event)
					? Effect.tryPromise(() => extractProminentColorsFromImageUrl(event.eventImageUrl)).pipe(
							Effect.timeout("3 seconds"),
							Effect.map((colors) => ({ ...event, ...colors })),
							Effect.catch((error) =>
								Effect.logWarning("Featured event image enrichment failed", {
									source,
									imageUrl: event.eventImageUrl,
									error,
								}).pipe(Effect.as(event)),
							),
						)
					: Effect.succeed(event),
			{ concurrency: 3 },
		);
	});

	const refresh = Effect.fn("FeaturedEventFeeds.refresh")(function* (
		source: string,
		force = false,
	) {
		// The database claim coordinates replicas. A forced webhook obtains a new
		// revision even during a poll; the older writer can no longer commit.
		const claimed = yield* repository.claim(source, force);
		if (!claimed) {
			return;
		}
		const cards = yield* fetchCards(source);
		const existingByImage = new Map(claimed.events?.map((event) => [event.eventImageUrl, event]));
		const fetched: FeaturedEventSourceItem[] = cards.map((card) => {
			const eventImageUrl = card.imageUrl ?? FALLBACK_IMAGE;
			const existing = existingByImage.get(eventImageUrl);
			return {
				sourceId: card.sourceId,
				allCampusEvent: source === HOME_FEATURED_SOURCE && card.allCampusEvent,
				eventTitle: card.eventTitle,
				description: card.description,
				eventImageUrl,
				pageLink: card.pageLink,
				slug: featuredEventSlug(card.pageLink),
				prominentColorDark: existing?.prominentColorDark ?? null,
				prominentColorLight: existing?.prominentColorLight ?? null,
				prominentColorAccent: existing?.prominentColorAccent ?? null,
			};
		});
		const events = yield* withProminentColors(source, fetched);
		const saved = yield* repository.save(source, claimed.revision, events);
		if (saved && !isDeepStrictEqual(claimed.events, events)) {
			yield* invalidateFeeds;
		}
	});

	const read = Effect.fn("FeaturedEventFeeds.read")(function* (campusSlug?: string | null) {
		const requestedSlug = campusSlug?.trim();
		const slug = Schema.is(CampusSlugSchema)(requestedSlug) ? requestedSlug : undefined;
		const sources = slug
			? [HOME_FEATURED_SOURCE, campusFeaturedSource(slug)]
			: [HOME_FEATURED_SOURCE];
		let snapshots = yield* repository.read(sources);
		const now = DateTime.toEpochMillis(yield* DateTime.now);
		const due = sources.filter((source) => {
			const snapshot = snapshots.find((entry) => entry.source === source);
			return !snapshot?.syncedAt || now - snapshot.syncedAt.getTime() >= 30_000;
		});
		if (due.length > 0) {
			yield* Effect.forEach(
				due,
				(source) =>
					refresh(source).pipe(
						Effect.catchTag("CMSFetchError", (error) =>
							snapshots.find((entry) => entry.source === source)?.events
								? Effect.logWarning("Serving last successful featured event snapshot", {
										source,
										error,
									})
								: Effect.fail(error),
						),
					),
				{ concurrency: 2 },
			);
			snapshots = yield* repository.read(sources);
		}
		// A different replica may be building the first snapshot. Wait only for
		// initialization; known-empty and stale successful snapshots remain usable.
		for (
			let attempt = 0;
			sources.some((source) => !snapshots.find((entry) => entry.source === source)?.events);
			attempt++
		) {
			if (attempt >= 40) {
				return yield* new CMSFetchError({ detail: "Featured event sources are not initialized" });
			}
			yield* Effect.sleep("250 millis");
			snapshots = yield* repository.read(sources);
		}
		const home = snapshots.find((entry) => entry.source === HOME_FEATURED_SOURCE)?.events ?? [];
		const local = slug
			? (snapshots.find((entry) => entry.source === campusFeaturedSource(slug))?.events ?? [])
			: [];
		return transformDbFeaturedEvents(
			local.length > 0 ? [...local, ...home.filter((event) => event.allCampusEvent)] : home,
		);
	});

	return { read, refresh };
});
