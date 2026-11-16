import { Schema } from "effect";

import { reoccurrenceValue, ReoccurrenceName } from "../enums";
import { toRichContent } from "../richContent";
import { toEditorJsString } from "../richText";
import { Media, mediaUrl, Meta, Text, trimmedOrNull } from "./shared";

import type { CmsEventsFilter } from "../inputs";
import type { CmsEvent, CmsEventSession, CmsRecurringTime } from "../records";
import type { GraphQLVariables, GraphQLVariableValue } from "../transport";

export const EVENTS_OPERATION = "StrapiV2Events";
export const EVENTS_DOCUMENT = `query StrapiV2Events($filters: EventFiltersInput, $sort: [String]) {
  events(filters: $filters, sort: $sort, pagination: { pageSize: 100 }) {
    slug
    EventName
    EventStartDate
    EventEndDate
    Reoccurrence
    ZoomLink
    body
    Header { title description featureImage { url } }
    Speaker(pagination: { pageSize: 100 }) { FullName Title Image { url } }
    Sessions(pagination: { pageSize: 100 }) { Date StartTime EndTime Label }
    MultipleTimes
    RecurringTimes(pagination: { pageSize: 100 }) { StartTime Label }
  }
}`;

const Event = Schema.Struct({
	slug: Text,
	EventName: Text,
	EventStartDate: Text,
	EventEndDate: Text,
	Reoccurrence: Schema.NullOr(ReoccurrenceName),
	ZoomLink: Text,
	body: Schema.Unknown,
	Header: Meta,
	Speaker: Schema.NullOr(Schema.Array(Schema.Struct({ FullName: Text, Title: Text, Image: Media }))),
	Sessions: Schema.NullOr(
		Schema.Array(Schema.Struct({ Date: Text, StartTime: Text, EndTime: Text, Label: Text })),
	),
	MultipleTimes: Schema.NullOr(Schema.Boolean),
	RecurringTimes: Schema.NullOr(Schema.Array(Schema.Struct({ StartTime: Text, Label: Text }))),
});

export const EventsData = Schema.Struct({ events: Schema.Array(Event) });

const HOUSE_OF_STARS = "house-of-stars";
// Stored value, not the GraphQL name: Strapi 5 filters compare stored strings.
const ONE_TIME_EVENT = "One time Event";

export const eventsVariables = (filter: CmsEventsFilter): GraphQLVariables => {
	const conditions: GraphQLVariableValue[] = [
		filter.campusSlug === HOUSE_OF_STARS
			? {
					or: [
						{ campuses: { documentId: { null: true } } },
						{ campuses: { slug: { eq: filter.campusSlug } } },
					],
				}
			: { campuses: { slug: { eq: filter.campusSlug } } },
	];
	const reoccurring = filter.reoccurring?.trim();
	if (reoccurring) {
		conditions.push({ Reoccurrence: { eq: reoccurring } });
	}
	if (filter.slug) {
		conditions.push({ slug: { eq: filter.slug } });
	}
	if (filter.upcomingFrom) {
		conditions.push({
			or: [
				{ EventEndDate: { gte: `${filter.upcomingFrom}T00:00:00.000Z` } },
				{ Reoccurrence: { ne: ONE_TIME_EVENT } },
			],
		});
	}
	return { filters: { and: conditions }, sort: filter.upcomingFrom ? ["EventStartDate:asc"] : [] };
};

type EventData = (typeof EventsData.Type)["events"][number];

// The server schedules an event without a recurrence as a one-time event.
const isOneTime = (event: EventData) => (event.Reoccurrence ?? "One_time_Event") === "One_time_Event";

// Hidden fields keep rows saved through the API, so read only the field editors can see.
const sessionsOf = (event: EventData): CmsEventSession[] =>
	isOneTime(event)
		? (event.Sessions ?? []).flatMap(({ Date, StartTime, EndTime, Label }) =>
				Date && StartTime
					? [{ date: Date, startTime: StartTime, endTime: EndTime, label: trimmedOrNull(Label) }]
					: [],
			)
		: [];

const recurringTimesOf = (event: EventData): CmsRecurringTime[] =>
	!isOneTime(event) && event.MultipleTimes === true
		? (event.RecurringTimes ?? []).flatMap(({ StartTime, Label }) =>
				StartTime ? [{ startTime: StartTime, label: trimmedOrNull(Label) }] : [],
			)
		: [];

export const toEventRecords = (data: typeof EventsData.Type): CmsEvent[] =>
	data.events.flatMap((event) => {
		// Without a slug or start date the server cannot link or schedule the event.
		if (event.slug === null || event.EventStartDate === null) {
			return [];
		}
		return [
			{
				slug: event.slug,
				pageName: event.EventName,
				eventTitle: event.Header?.title ?? event.EventName,
				description: event.Header?.description ?? null,
				body: toEditorJsString(event.body),
				content: toRichContent(event.body),
				startDate: event.EventStartDate,
				endDate: event.EventEndDate,
				reoccurring: event.Reoccurrence === null ? null : reoccurrenceValue(event.Reoccurrence),
				room: null,
				zoomLink: event.ZoomLink,
				speakers: (event.Speaker ?? []).map((speaker) => ({
					fullName: speaker.FullName,
					title: trimmedOrNull(speaker.Title),
					image: mediaUrl(speaker.Image),
				})),
				imageUrl: mediaUrl(event.Header?.featureImage ?? null),
				sessions: sessionsOf(event),
				recurringTimes: recurringTimesOf(event),
			},
		];
	});
