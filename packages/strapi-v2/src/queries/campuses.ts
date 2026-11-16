import { Schema } from "effect";

import { GivingPlatformName, leadershipGroupValue, LeadershipGroupName } from "../enums";
import { toRichContent } from "../richContent";
import { toEditorJsString } from "../richText";
import { Media, mediaUrl, Meta, Text } from "./shared";

import type { CmsCampus } from "../records";

export const CAMPUSES_OPERATION = "StrapiV2Campuses";

export const CAMPUSES_DOCUMENT = `query StrapiV2Campuses {
  campuses(pagination: { pageSize: 100 }) {
    slug
    CampusName
    Phone
    Address
    CityState
    FacebookChannelLink
    InstagramChannelLink
    LiveStreamChannelLink
    body
    Header { title description featureImage { url } }
    Stream { CastrID }
    GivingPlatforms(pagination: { pageSize: 100 }) { Platform link }
    leaderships(pagination: { pageSize: 100 }) {
      PageName
      slug
      Heading { featureImage { url } }
      Leader { LeadershipGroup BioIntro body ProfilePicture { url } }
    }
  }
}`;

const Leadership = Schema.Struct({
	PageName: Text,
	slug: Text,
	Heading: Schema.NullOr(Schema.Struct({ featureImage: Media })),
	Leader: Schema.NullOr(
		Schema.Struct({
			LeadershipGroup: Schema.NullOr(LeadershipGroupName),
			BioIntro: Text,
			body: Schema.Unknown,
			ProfilePicture: Media,
		}),
	),
});

const Campus = Schema.Struct({
	slug: Text,
	CampusName: Text,
	Phone: Text,
	Address: Text,
	CityState: Text,
	FacebookChannelLink: Text,
	InstagramChannelLink: Text,
	LiveStreamChannelLink: Text,
	body: Schema.Unknown,
	Header: Meta,
	Stream: Schema.NullOr(Schema.Struct({ CastrID: Text })),
	GivingPlatforms: Schema.NullOr(
		Schema.Array(Schema.Struct({ Platform: Schema.NullOr(GivingPlatformName), link: Text })),
	),
	leaderships: Schema.Array(Leadership),
});

export const CampusesData = Schema.Struct({ campuses: Schema.Array(Campus) });

const collapse = (text: string) => text.replaceAll(/\s+/gu, " ").trim();

/** Strapi 5 requires Address and CityState, so a campus without one holds a placeholder like "-". */
const placeName = (text: string | null) => (text !== null && /[\p{L}\p{N}]/u.test(text) ? text : null);

/**
 * The leader's one-line title, as Strapi 4's `LeaderIntro.subTitle` was: Strapi 5's BioIntro can
 * hold several lines (title, campus, phone), so the first non-empty line is the title, without a
 * trailing ": Name" that repeats the leader's own name.
 */
const leaderTitle = (bioIntro: string | null, name: string | null): string | null => {
	const [first] = (bioIntro ?? "").split("\n").map(collapse).filter((line) => line !== "");
	if (first === undefined) {
		return null;
	}
	const separator = first.indexOf(":");
	const named = separator > 0 ? collapse(first.slice(separator + 1)).toLowerCase() : "";
	return named !== "" && name !== null && collapse(name).toLowerCase().includes(named)
		? collapse(first.slice(0, separator))
		: first;
};

export const toCampusRecords = (data: typeof CampusesData.Type): CmsCampus[] =>
	data.campuses.flatMap((campus) => {
		if (campus.slug === null) {
			return [];
		}
		return [
			{
				slug: campus.slug,
				name: campus.CampusName,
				description: campus.Header?.description ?? null,
				image: mediaUrl(campus.Header?.featureImage ?? null),
				phone: campus.Phone,
				address: placeName(campus.Address),
				cityState: placeName(campus.CityState),
				facebook: campus.FacebookChannelLink,
				instagram: campus.InstagramChannelLink,
				streamLink: campus.LiveStreamChannelLink,
				castrStreamId: campus.Stream?.CastrID ?? null,
				body: toEditorJsString(campus.body),
				content: toRichContent(campus.body),
				giving: (campus.GivingPlatforms ?? []).flatMap((entry) => {
					const value = entry.link?.trim();
					return entry.Platform === null || value === undefined || value === ""
						? []
						: [{ platform: entry.Platform, value }];
				}),
				// CMS order is editor-controlled; the server picks the lead pastor from it.
				leaders: campus.leaderships.map((leadership) => {
					const group = leadership.Leader?.LeadershipGroup ?? null;
					return {
						name: leadership.PageName,
						slug: leadership.slug,
						group: group === null ? null : leadershipGroupValue(group),
						bio: leaderTitle(leadership.Leader?.BioIntro ?? null, leadership.PageName),
						image:
							mediaUrl(leadership.Leader?.ProfilePicture ?? null) ??
							mediaUrl(leadership.Heading?.featureImage ?? null),
						body: toEditorJsString(leadership.Leader?.body ?? null),
					};
				}),
			},
		];
	});
