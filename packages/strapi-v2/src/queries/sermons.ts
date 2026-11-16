import { Schema } from "effect";

import { toEditorJsString } from "../richText";
import { Media, mediaUrl, Meta, Text, trimmedOrNull } from "./shared";

import type { CmsSermonCursor, CmsSermonsQuery } from "../inputs";
import type { CmsSermonPage } from "../records";
import type { GraphQLVariables, GraphQLVariableValue } from "../transport";

export const SERMONS_OPERATION = "StrapiV2Sermons";
export const SERMONS_DOCUMENT = `query StrapiV2Sermons($filters: SermonFiltersInput, $sort: [String], $pageSize: Int) {
  sermons(filters: $filters, sort: $sort, pagination: { pageSize: $pageSize }) {
    slug
    Title
    date
    YoutubeLink
    Thumbnail { url }
    Speaker { FullName Title Image { url } }
  }
  sermonPage { Intro { title description featureImage { url } } body }
}`;

const Sermon = Schema.Struct({
	slug: Text,
	Title: Text,
	date: Text,
	YoutubeLink: Text,
	Thumbnail: Media,
	Speaker: Schema.NullOr(Schema.Struct({ FullName: Text, Title: Text, Image: Media })),
});

export const SermonsData = Schema.Struct({
	sermons: Schema.Array(Sermon),
	sermonPage: Schema.NullOr(Schema.Struct({ Intro: Meta, body: Schema.Unknown })),
});

export const sermonsVariables = (query: CmsSermonsQuery): GraphQLVariables => {
	if (query.kind === "slugs") {
		return { filters: { slug: { in: [...query.slugs] } }, sort: ["date:desc"], pageSize: 100 };
	}
	if (query.after) {
		return { filters: beyond(query.after, "lt"), sort: ["date:desc", "slug:desc"], pageSize: query.pageSize };
	}
	if (query.before) {
		return { filters: beyond(query.before, "gt"), sort: ["date:asc", "slug:asc"], pageSize: query.pageSize };
	}
	return { filters: {}, sort: ["date:desc", "slug:desc"], pageSize: query.pageSize };
};

// Sermons past the cursor in (date, slug) order, so a page can end partway through a day.
const beyond = ({ date, slug }: CmsSermonCursor, operator: "lt" | "gt"): GraphQLVariableValue => ({
	or: [{ date: { [operator]: date } }, { date: { eq: date }, slug: { [operator]: slug } }],
});

export const toSermonPage = (data: typeof SermonsData.Type): CmsSermonPage => ({
	items: data.sermons.flatMap((sermon) =>
		sermon.slug === null
			? []
			: [
					{
						slug: sermon.slug,
						title: sermon.Title,
						date: sermon.date,
						thumbnail: mediaUrl(sermon.Thumbnail),
						speaker:
							sermon.Speaker === null
								? null
								: {
										fullName: sermon.Speaker.FullName,
										title: trimmedOrNull(sermon.Speaker.Title),
										image: mediaUrl(sermon.Speaker.Image),
									},
						youtubeLink: sermon.YoutubeLink,
						// Strapi 4 kept a separate pageName that always equalled the title.
						pageName: sermon.Title,
					},
				],
	),
	featuredImg: mediaUrl(data.sermonPage?.Intro?.featureImage ?? null),
	body: toEditorJsString(data.sermonPage?.body ?? null),
});
