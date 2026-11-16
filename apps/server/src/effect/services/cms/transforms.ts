import {
	CORE_SETTINGS_ID,
	FALLBACK_IMAGE,
	MORE_LINKS,
	FEATURED_EVENT_PAGE_URL_PREFIX,
} from "@/effect/services/cms/constants";
import { resolveProminentColors } from "@/effect/services/cms/prominentColors";
import { RecurrenceCalculator, type RecurringType } from "@/utils/recurrenceCalculator";
import { DateTime } from "luxon";

import type { coreSettings, featuredEvents, upComingEvents } from "@/db/schema";
import type {
	CoreData,
	FeaturedEvent,
	HomeData,
	ReoccurringType,
	UpComingEvent,
} from "@/effect/services/cms/types";
import type { CmsCoreSection, CmsCoreSections, CmsFeaturedCard } from "@hccnj/strapi-v2";

type FeaturedEventsData = typeof featuredEvents.$inferInsert;
type CoreSettingsData = typeof coreSettings.$inferInsert;
type CoreSettingsRow = typeof coreSettings.$inferSelect;
type FeaturedEventRow = typeof featuredEvents.$inferSelect;
type UpComingEventRow = typeof upComingEvents.$inferSelect;

export const featuredEventSlug = (pageLink: string | null): string | null =>
	pageLink?.replace(FEATURED_EVENT_PAGE_URL_PREFIX, "").replace("/", "") ?? null;

export function transformCardsToFeaturedEvents(
	cards: readonly CmsFeaturedCard[],
): FeaturedEventsData[] {
	return cards.map((card) => ({
		eventImageUrl: card.imageUrl ?? FALLBACK_IMAGE,
		eventTitle: card.eventTitle,
		description: card.description,
		pageLink: card.pageLink,
		slug: featuredEventSlug(card.pageLink),
	}));
}

// An absent section (Strapi 5 has no profile, sermons or events) leaves both
// columns undefined, so the upsert keeps the stored values. A present section
// writes its copy as is, so a null copy is stored as NULL.
const sectionImage = (section: CmsCoreSection | undefined) =>
	section === undefined ? undefined : (section.image ?? FALLBACK_IMAGE);
const sectionCopy = (section: CmsCoreSection | undefined) =>
	section === undefined ? undefined : section.copy;

export function coreSettingsColumns(sections: CmsCoreSections): CoreSettingsData {
	return {
		id: CORE_SETTINGS_ID,
		givingFeatureImage: sectionImage(sections.giving),
		givingCopy: sectionCopy(sections.giving),
		profileFeatureImage: sectionImage(sections.profile),
		profileCopy: sectionCopy(sections.profile),
		sermonsFeatureImage: sectionImage(sections.sermons),
		sermonsCopy: sectionCopy(sections.sermons),
		hccExpressionFeatureImage: sectionImage(sections.hccexpression),
		hccExpressionCopy: sectionCopy(sections.hccexpression),
		eventsFeatureImage: sectionImage(sections.events),
		eventsCopy: sectionCopy(sections.events),
		moreFeatureImage: sectionImage(sections.more),
		moreCopy: sectionCopy(sections.more),
	};
}

export function transformDbCoreSettings(data: CoreSettingsRow): CoreData {
	return {
		giving: {
			featureImge: data.givingFeatureImage ?? FALLBACK_IMAGE,
			copy: data.givingCopy ?? "Giving",
		},
		profile: {
			featureImge: data.profileFeatureImage ?? FALLBACK_IMAGE,
			copy: data.profileCopy ?? "Profile",
		},
		sermons: {
			featureImge: data.sermonsFeatureImage ?? FALLBACK_IMAGE,
			copy: data.sermonsCopy ?? "Sermons",
		},
		hccexpression: {
			featureImge: data.hccExpressionFeatureImage ?? FALLBACK_IMAGE,
			copy: data.hccExpressionCopy ?? "HCC Expression",
		},
		events: {
			featureImge: data.eventsFeatureImage ?? FALLBACK_IMAGE,
			copy: data.eventsCopy ?? "Events",
		},
		more: {
			featureImge: data.moreFeatureImage ?? FALLBACK_IMAGE,
			copy: data.moreCopy ?? "More",
			links: MORE_LINKS,
		},
	};
}

export function transformDbFeaturedEvents(featuredResult: FeaturedEventsData[]): FeaturedEvent[] {
	return featuredResult.map((event) => {
		const base = {
			eventTitle: event.eventTitle,
			description: event.description,
			eventImageUrl: event.eventImageUrl,
			prominentColors: resolveProminentColors({
				prominentColorDark: event.prominentColorDark ?? null,
				prominentColorLight: event.prominentColorLight ?? null,
				prominentColorAccent: event.prominentColorAccent ?? null,
			}),
			slug: event.slug ?? null,
		};
		return event.pageLink ? { ...base, pageLink: event.pageLink } : base;
	});
}

export function transformDbResults(
	featuredResult: FeaturedEventRow[],
	upcomingResult: UpComingEventRow[],
): HomeData {
	const transformedUpcoming: UpComingEvent[] = upcomingResult
		.map((event) => {
			const normalizedRecurring = (event.reoccurring?.trim() || event.reoccurring) as RecurringType;
			const eventDateTime = DateTime.fromJSDate(event.eventDate);
			const nextOccurrence = RecurrenceCalculator.getNextOccurrence(
				eventDateTime,
				normalizedRecurring,
			);

			return {
				eventTitle: event.eventTitle,
				description: event.description,
				slug: event.slug,
				image: event.image,
				reoccurring: event.reoccurring as ReoccurringType,
				eventTime: event.eventTime,
				eventDate: nextOccurrence.toJSON()!,
				eventMonth: event.eventMonth,
			};
		})
		.toSorted((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());

	return {
		featuredEvents: { events: transformDbFeaturedEvents(featuredResult) },
		upComingEvents: transformedUpcoming,
	};
}
