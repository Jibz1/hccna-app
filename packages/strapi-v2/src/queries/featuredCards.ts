import { Schema } from "effect";

import { Media, mediaUrl, Text } from "./shared";

import type { CmsFeaturedCard } from "../records";

const CARD_FIELDS = "id EventName Description pagetLink FeatureImage { url }";

export const HOME_CARDS_OPERATION = "StrapiV2HomeFeaturedCards";
export const HOME_CARDS_DOCUMENT = `query StrapiV2HomeFeaturedCards {
  home { FeaturedEvents(pagination: { pageSize: 100 }) { ${CARD_FIELDS} allCampusEvent } }
}`;

// Campus cards use their own component, which has no all-campus flag.
export const CAMPUS_CARDS_OPERATION = "StrapiV2CampusFeaturedCards";
export const CAMPUS_CARDS_DOCUMENT = `query StrapiV2CampusFeaturedCards($slug: String!) {
  campuses(filters: { slug: { eq: $slug } }, pagination: { pageSize: 100 }) { slug CampusFeatureEvent(pagination: { pageSize: 100 }) { ${CARD_FIELDS} } }
}`;

// EventName and Description are required: a card without them fails decoding,
// so the feed keeps its last snapshot, exactly like the Strapi 4 path.
const CampusCard = Schema.Struct({
	id: Schema.String,
	EventName: Schema.String,
	Description: Schema.String,
	pagetLink: Text,
	FeatureImage: Media,
});

const HomeCard = Schema.Struct({ ...CampusCard.fields, allCampusEvent: Schema.NullOr(Schema.Boolean) });

export const HomeCardsData = Schema.Struct({
	home: Schema.NullOr(Schema.Struct({ FeaturedEvents: Schema.NullOr(Schema.Array(HomeCard)) })),
});

export const CampusCardsData = Schema.Struct({
	campuses: Schema.Array(Schema.Struct({ slug: Text, CampusFeatureEvent: Schema.NullOr(Schema.Array(CampusCard)) })),
});

const toCard = (card: typeof CampusCard.Type, allCampusEvent: boolean): CmsFeaturedCard => {
	const id = Number(card.id);
	return {
		sourceId: Number.isFinite(id) ? id : null,
		eventTitle: card.EventName,
		description: card.Description,
		imageUrl: mediaUrl(card.FeatureImage),
		pageLink: card.pagetLink,
		allCampusEvent,
	};
};

/** `null` when the home single type is missing or unpublished. */
export const toHomeCards = (data: typeof HomeCardsData.Type): CmsFeaturedCard[] | null =>
	data.home === null
		? null
		: // Cards created before the field existed return null.
			(data.home.FeaturedEvents ?? []).map((card) => toCard(card, card.allCampusEvent === true));

export const toCampusCards = (data: typeof CampusCardsData.Type, slug: string): CmsFeaturedCard[] =>
	(data.campuses.find((campus) => campus.slug === slug)?.CampusFeatureEvent ?? []).map((card) => toCard(card, false));
