import { Schema } from "effect";

import { Text } from "./shared";

import type { CmsStreamAcl } from "../records";

// The two special stream slugs and their Strapi channel names: the single source for the server's stream access.
const SPECIAL_STREAM_CHANNELS: Readonly<Record<string, string>> = {
	"house-of-stars-junior-church": "HCC JUNIOR CHURCH",
	"joseph-siju": "PST JOSEPH SIJU",
};

export const SPECIAL_STREAM_SLUGS: readonly string[] = Object.keys(SPECIAL_STREAM_CHANNELS);

export const specialStreamChannelName = (slug: string): string | undefined =>
	Object.hasOwn(SPECIAL_STREAM_CHANNELS, slug) ? SPECIAL_STREAM_CHANNELS[slug] : undefined;

const Coordinators = Schema.NullOr(Schema.Array(Schema.Struct({ email: Text, excludesIDs: Text })));

export const STREAM_CHANNELS_OPERATION = "StrapiV2StreamChannels";
export const STREAM_CHANNELS_DOCUMENT = `query StrapiV2StreamChannels {
  stream { StreamChannel(pagination: { pageSize: 100 }) { ChannelName CastrID CoordinatorEmails(pagination: { pageSize: 100 }) { email excludesIDs } } }
}`;

export const StreamChannelsData = Schema.Struct({
	stream: Schema.NullOr(
		Schema.Struct({
			StreamChannel: Schema.NullOr(
				Schema.Array(Schema.Struct({ ChannelName: Text, CastrID: Text, CoordinatorEmails: Coordinators })),
			),
		}),
	),
});

export const CAMPUS_STREAM_OPERATION = "StrapiV2CampusStream";
export const CAMPUS_STREAM_DOCUMENT = `query StrapiV2CampusStream($slug: String!) {
  campuses(filters: { slug: { eq: $slug } }, pagination: { pageSize: 100 }) { slug Stream { CastrID CoordinatorEmails(pagination: { pageSize: 100 }) { email excludesIDs } } }
}`;

export const CampusStreamData = Schema.Struct({
	campuses: Schema.Array(
		Schema.Struct({
			slug: Text,
			Stream: Schema.NullOr(Schema.Struct({ CastrID: Text, CoordinatorEmails: Coordinators })),
		}),
	),
});

const toCoordinators = (rows: typeof Coordinators.Type): CmsStreamAcl["coordinators"] =>
	(rows ?? []).map((row) => ({ email: row.email, excludesIds: row.excludesIDs }));

export const toChannelAcl = (
	data: typeof StreamChannelsData.Type,
	channelName: string,
): CmsStreamAcl | null => {
	const channel = data.stream?.StreamChannel?.find((candidate) => candidate.ChannelName === channelName);
	return channel === undefined
		? null
		: { streamId: channel.CastrID, coordinators: toCoordinators(channel.CoordinatorEmails) };
};

/** Fails closed: only the campus whose slug matches the request authorizes anything. */
export const toCampusAcl = (data: typeof CampusStreamData.Type, slug: string): CmsStreamAcl | null => {
	const stream = data.campuses.find((campus) => campus.slug === slug)?.Stream;
	return stream === undefined || stream === null
		? null
		: { streamId: stream.CastrID, coordinators: toCoordinators(stream.CoordinatorEmails) };
};
