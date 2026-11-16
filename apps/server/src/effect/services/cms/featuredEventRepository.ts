import { featuredEventSources, type FeaturedEventSourceItem } from "@/db/schema";
import { CMSFetchError } from "@/effect/services/CMSErrors";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { CAMPUS_SLUGS } from "@/utils/campuses";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

export const HOME_FEATURED_SOURCE = "home";
export const campusFeaturedSource = (slug: string) => `campus:${slug}`;
const FEATURED_SOURCES = [
	HOME_FEATURED_SOURCE,
	...CAMPUS_SLUGS.map((slug) => campusFeaturedSource(slug)),
];

export const makeFeaturedEventRepository = Effect.gen(function* () {
	const { db } = yield* DrizzleService;
	const read = Effect.fn("FeaturedEventRepository.read")(function* (sources: string[]) {
		return yield* Effect.tryPromise({
			try: () =>
				db.select().from(featuredEventSources).where(inArray(featuredEventSources.source, sources)),
			catch: (cause) =>
				new CMSFetchError({ detail: "Failed to read featured event sources", cause }),
		});
	});
	const claim = Effect.fn("FeaturedEventRepository.claim")(function* (
		source: string,
		force: boolean,
	) {
		if (!FEATURED_SOURCES.includes(source)) {
			return;
		}
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.insert(featuredEventSources)
					.values({ source, revision: 1, attemptedAt: sql`clock_timestamp()` })
					.onConflictDoUpdate({
						target: featuredEventSources.source,
						set: {
							revision: sql`${featuredEventSources.revision} + 1`,
							attemptedAt: sql`clock_timestamp()`,
						},
						setWhere: force
							? sql`true`
							: sql`${featuredEventSources.attemptedAt} is null or ${featuredEventSources.attemptedAt} < clock_timestamp() - interval '30 seconds'`,
					})
					.returning(),
			catch: (cause) =>
				new CMSFetchError({ detail: "Failed to claim featured event refresh", cause }),
		});
		return rows[0];
	});
	const save = Effect.fn("FeaturedEventRepository.save")(function* (
		source: string,
		revision: number,
		events: FeaturedEventSourceItem[],
	) {
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.update(featuredEventSources)
					.set({ events, contentRevision: revision, syncedAt: sql`clock_timestamp()` })
					.where(
						and(
							eq(featuredEventSources.source, source),
							eq(featuredEventSources.revision, revision),
						),
					)
					.returning(),
			catch: (cause) =>
				new CMSFetchError({ detail: "Failed to save featured event source", cause }),
		});
		return rows[0];
	});
	return { read, claim, save };
});
