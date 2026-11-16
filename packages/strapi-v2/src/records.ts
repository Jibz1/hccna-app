import { Schema } from "effect";

import { GivingPlatformName } from "./enums";
import { RichDocumentSchema } from "./richContent";

/**
 * The records the server reads from Strapi 5. Each value keeps the meaning the
 * server's Strapi 4 reads had, so the GraphQL wire format did not change. Records are
 * plain data (Schema.Struct) so they survive a JSON round trip through Redis.
 */
const Text = Schema.NullOr(Schema.String);
/** The rich text the app renders (`toRichContent`); `body` stays the EditorJS string installed apps read. */
const Content = Schema.NullOr(RichDocumentSchema);

export const CmsGivingEntry = Schema.Struct({ platform: GivingPlatformName, value: Schema.String });
export type CmsGivingEntry = typeof CmsGivingEntry.Type;

export const CmsLeader = Schema.Struct({
	name: Text,
	slug: Text,
	group: Text,
	bio: Text,
	image: Text,
	body: Text,
});
export type CmsLeader = typeof CmsLeader.Type;

export const CmsCampus = Schema.Struct({
	slug: Schema.String,
	name: Text,
	description: Text,
	image: Text,
	phone: Text,
	address: Text,
	cityState: Text,
	facebook: Text,
	instagram: Text,
	streamLink: Text,
	castrStreamId: Text,
	body: Text,
	content: Content,
	giving: Schema.Array(CmsGivingEntry),
	leaders: Schema.Array(CmsLeader),
});
export type CmsCampus = typeof CmsCampus.Type;

export const CmsSpeaker = Schema.Struct({ fullName: Text, title: Text, image: Text });
export type CmsSpeaker = typeof CmsSpeaker.Type;

/** One dated session of a one-time event: New York wall-clock date and times. */
export const CmsEventSession = Schema.Struct({
	date: Schema.String,
	startTime: Schema.String,
	endTime: Text,
	label: Text,
});
export type CmsEventSession = typeof CmsEventSession.Type;

/** A New York start time on every day a recurring event happens. */
export const CmsRecurringTime = Schema.Struct({ startTime: Schema.String, label: Text });
export type CmsRecurringTime = typeof CmsRecurringTime.Type;

export const CmsEvent = Schema.Struct({
	slug: Schema.String,
	pageName: Text,
	eventTitle: Text,
	description: Text,
	body: Text,
	content: Content,
	startDate: Schema.String,
	endDate: Text,
	reoccurring: Text,
	room: Text,
	zoomLink: Text,
	speakers: Schema.NullOr(Schema.Array(CmsSpeaker)),
	imageUrl: Text,
	/** Only for one-time events; empty when the event has one start and end. */
	sessions: Schema.Array(CmsEventSession),
	/** Only for recurring events with multiple times switched on. */
	recurringTimes: Schema.Array(CmsRecurringTime),
});
export type CmsEvent = typeof CmsEvent.Type;

export const CmsSermon = Schema.Struct({
	slug: Schema.String,
	title: Text,
	date: Text,
	thumbnail: Text,
	speaker: Schema.NullOr(CmsSpeaker),
	youtubeLink: Text,
	pageName: Text,
});
export type CmsSermon = typeof CmsSermon.Type;

export const CmsSermonPage = Schema.Struct({
	items: Schema.Array(CmsSermon),
	featuredImg: Text,
	body: Text,
});
export type CmsSermonPage = typeof CmsSermonPage.Type;

export const CmsThoughtOfGod = Schema.Struct({
	title: Text,
	description: Text,
	thumbnail: Text,
	blogs: Schema.Array(
		Schema.Struct({ title: Text, description: Text, link: Text, date: Text, thumbnail: Text }),
	),
	youtube: Schema.Array(
		Schema.Struct({ youtubeLink: Text, title: Text, thumbnail: Text, body: Text }),
	),
});
export type CmsThoughtOfGod = typeof CmsThoughtOfGod.Type;

export const CmsFeaturedCard = Schema.Struct({
	sourceId: Schema.NullOr(Schema.Number),
	eventTitle: Schema.String,
	description: Schema.String,
	imageUrl: Text,
	pageLink: Text,
	allCampusEvent: Schema.Boolean,
});
export type CmsFeaturedCard = typeof CmsFeaturedCard.Type;

export const CmsCoreSection = Schema.Struct({ copy: Text, image: Text });
export type CmsCoreSection = typeof CmsCoreSection.Type;

/** A missing key means "this CMS has no source for the section": the server keeps the stored value. */
export const CmsCoreSections = Schema.Struct({
	giving: Schema.optionalKey(CmsCoreSection),
	profile: Schema.optionalKey(CmsCoreSection),
	sermons: Schema.optionalKey(CmsCoreSection),
	hccexpression: Schema.optionalKey(CmsCoreSection),
	events: Schema.optionalKey(CmsCoreSection),
	more: Schema.optionalKey(CmsCoreSection),
});
export type CmsCoreSections = typeof CmsCoreSections.Type;

export const CmsStreamAcl = Schema.Struct({
	streamId: Text,
	coordinators: Schema.Array(Schema.Struct({ email: Text, excludesIds: Text })),
});
export type CmsStreamAcl = typeof CmsStreamAcl.Type;

export const CmsCheckInPermission = Schema.Struct({
	eventName: Text,
	description: Text,
	eventCcbId: Text,
	groupCcbId: Text,
	coordinatorEmails: Schema.Array(Text),
});
export type CmsCheckInPermission = typeof CmsCheckInPermission.Type;

export const CmsDepartment = Schema.Struct({
	id: Schema.Number,
	slug: Text,
	ccbId: Text,
	name: Text,
	fullName: Text,
	description: Text,
	image: Text,
});
export type CmsDepartment = typeof CmsDepartment.Type;

export const CmsMinistry = Schema.Struct({
	id: Schema.Number,
	slug: Text,
	ccbId: Text,
	name: Text,
	description: Text,
	image: Text,
});
export type CmsMinistry = typeof CmsMinistry.Type;
