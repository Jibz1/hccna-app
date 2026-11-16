import { CmsContent, type CmsContentError } from "@/effect/services/cms/content/CmsContent";
import { createMockContext } from "@/graphql/__tests__/utils/test-context";
import { schema } from "@/graphql/schema";
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { Effect } from "effect";
import { execute, parse, type ExecutionResult } from "graphql";

import type { CmsEvent } from "@hccnj/strapi-v2";

const event: CmsEvent = {
	slug: "sunday-service",
	pageName: "Sunday Service",
	eventTitle: "Sunday Service",
	description: null,
	body: null,
	content: null,
	startDate: "2026-10-04T14:00:00.000Z",
	endDate: null,
	reoccurring: "Weekly",
	room: null,
	zoomLink: null,
	speakers: null,
	imageUrl: null,
	sessions: [],
	recurringTimes: [],
};

const contextWith = (events: Effect.Effect<readonly CmsEvent[], CmsContentError>) => {
	const cms = { events: () => events } as never;
	return createMockContext({
		authorized: true,
		authType: "jwt",
		currentUserUid: "u",
		currentUserEmail: "u@example.com",
		effectRunPromise: (<A, E, R>(program: Effect.Effect<A, E, R>) =>
			Effect.runPromise(
				(program as Effect.Effect<A, E, CmsContent>).pipe(Effect.provideService(CmsContent, cms)),
			)) as never,
	});
};

describe("events", () => {
	it("exposes the rich text content the app renders next to the EditorJS body", async () => {
		const content = {
			type: "doc" as const,
			content: [{ type: "paragraph", content: [{ type: "text", text: "Join us" }] }],
		};
		const result = await execute({
			schema,
			document: parse(
				'query { events(slug: "sunday-service", campusSlug: "house-of-stars") { slug body content } }',
			),
			contextValue: contextWith(Effect.succeed([{ ...event, body: "{}", content }])),
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			events: [{ slug: "sunday-service", body: "{}", content }],
		});
	});

	it("answers null content when the event has no body", async () => {
		const result = await execute({
			schema,
			document: parse('query { events(slug: "sunday-service") { slug content } }'),
			contextValue: contextWith(Effect.succeed([event])),
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			events: [{ slug: "sunday-service", content: null }],
		});
	});
});

// The operations installed 2.0.x apps send (apps/mobile at bc379ec). These apps cannot be
// updated over the air, so the fields they read must keep their exact formats.
const INSTALLED_LATEST_EVENTS = `query LatestEventsQuery($campusSlug: String!) {
  upcomingEventsByMonth(campusSlug: $campusSlug) {
    __typename
    ... on UpcomingEventsByMonthSuccess {
      months { month year events { eventTitle eventDate description slug eventSpeakers { image } } }
    }
    ... on UpcomingEventsByMonthFetchError { message }
  }
}`;
const INSTALLED_EVENT_DETAIL = `query EventDetailQuery($slug: String!, $campusSlug: String!) {
  events(slug: $slug, campusSlug: $campusSlug) {
    description eventDate eventImageUrl eventTime eventTitle pageTitle reoccurring slug
    eventMonth pageName body zoomLink eventSpeakers { fullName image } room
  }
}`;

const record = (overrides: Partial<CmsEvent>): CmsEvent => ({
	...event,
	...overrides,
});
const firstEvent = (data: ExecutionResult["data"]) => {
	const events = data?.["events"];
	return Array.isArray(events) ? events[0] : undefined;
};
const sessionOf =
	(slug: string) => (startsAt: string, endsAt: string | null, label: string | null) => ({
		id: `${slug}@${startsAt}`,
		startsAt: new Date(startsAt),
		endsAt: endsAt === null ? null : new Date(endsAt),
		label,
	});
const run = async (query: string, variables: Record<string, string>, events: CmsEvent[]) => {
	const result = await execute({
		schema,
		document: parse(query),
		variableValues: variables,
		contextValue: contextWith(Effect.succeed(events)),
	});
	expect(result.errors).toBeUndefined();
	return result.data;
};
const listed = (slug: string, title: string, eventDate: string) => ({
	eventTitle: title,
	eventDate,
	description: null,
	slug,
	eventSpeakers: null,
});
const detail = async (events: CmsEvent[]) =>
	firstEvent(
		await run(
			INSTALLED_EVENT_DETAIL,
			{ slug: events[0]!.slug, campusSlug: "house-of-stars" },
			events,
		),
	);
const harvestNight = record({
	slug: "harvest-night",
	pageName: "Harvest Night",
	eventTitle: "Harvest Night",
	startDate: "2026-11-14T14:00:00.000Z",
	endDate: "2026-11-14T17:00:00.000Z",
	reoccurring: "One time Event",
});
// Strapi 4 stores the daily recurrence with a trailing space.
const prayerLine = record({
	slug: "prayer-line",
	pageName: "Prayer Line",
	eventTitle: "Prayer Line",
	startDate: "2026-09-01T23:00:00.000Z",
	reoccurring: "Daily ",
});
const youthRetreat = record({
	slug: "youth-retreat",
	pageName: "Youth Retreat",
	eventTitle: "Youth Retreat",
	startDate: "2026-10-05T23:00:00.000Z",
	endDate: "2026-10-08T01:00:00.000Z",
	reoccurring: "One time Event",
});

describe("fields installed apps read", () => {
	// Tuesday 6 October 2026, noon in New York.
	beforeEach(() => setSystemTime(new Date("2026-10-06T16:00:00.000Z")));
	afterEach(() => setSystemTime());

	it("lists upcoming events by New York month at their next date", async () => {
		const data = await run(INSTALLED_LATEST_EVENTS, { campusSlug: "house-of-stars" }, [
			harvestNight,
			event,
			prayerLine,
			youthRetreat,
		]);

		expect(data).toEqual({
			upcomingEventsByMonth: {
				__typename: "UpcomingEventsByMonthSuccess",
				months: [
					{
						month: "October",
						year: 2026,
						events: [
							listed("youth-retreat", "Youth Retreat", "2026-10-05T19:00:00.000-04:00"),
							listed("prayer-line", "Prayer Line", "2026-10-06T19:00:00.000-04:00"),
							listed("sunday-service", "Sunday Service", "2026-10-11T10:00:00.000-04:00"),
						],
					},
					{
						month: "November",
						year: 2026,
						events: [listed("harvest-night", "Harvest Night", "2026-11-14T09:00:00.000-05:00")],
					},
				],
			},
		});
	});

	it("details an event with its next date, Eastern time and month", async () => {
		expect(await detail([harvestNight])).toEqual({
			description: null,
			eventDate: "2026-11-14T09:00:00.000-05:00",
			eventImageUrl: "",
			eventTime: "09:00:00-05:00",
			eventTitle: "Harvest Night",
			pageTitle: "Harvest Night",
			reoccurring: "One time Event",
			slug: "harvest-night",
			eventMonth: "November",
			pageName: "Harvest Night",
			body: null,
			zoomLink: null,
			eventSpeakers: null,
			room: null,
		});
		expect(await detail([event])).toMatchObject({
			eventDate: "2026-10-11T10:00:00.000-04:00",
			eventTime: "10:00:00-04:00",
			eventMonth: "October",
			reoccurring: "Weekly",
		});
		expect(await detail([prayerLine])).toMatchObject({
			eventDate: "2026-10-06T19:00:00.000-04:00",
			eventTime: "19:00:00-04:00",
			eventMonth: "October",
			reoccurring: "Daily ",
		});
	});
});

const SCHEDULE = `query Schedule($slug: String!) {
  events(slug: $slug) {
    eventDate eventTime eventMonth startsAt endsAt
    sessions { id startsAt endsAt label }
  }
}`;

const kingdomCulture = record({
	slug: "kingdom-culture",
	startDate: "2026-10-05T23:00:00.000Z",
	endDate: "2026-10-08T01:00:00.000Z",
	reoccurring: "One time Event",
	sessions: [
		{
			date: "2026-10-07",
			startTime: "19:00:00.000",
			endTime: "21:00:00.000",
			label: "Night three",
		},
		{
			date: "2026-10-05",
			startTime: "19:00:00.000",
			endTime: "21:00:00.000",
			label: "Opening night",
		},
		{
			date: "2026-10-06",
			startTime: "10:00:00.000",
			endTime: "12:30:00.000",
			label: "Morning",
		},
		{
			date: "2026-10-06",
			startTime: "19:00:00.000",
			endTime: null,
			label: null,
		},
	],
});
// The CMS moves a recurring start to its earliest time: Sunday 9:00 in New York.
const twoServices = record({
	startDate: "2026-10-04T13:00:00.000Z",
	recurringTimes: [
		{ startTime: "11:00:00.000", label: "Second service" },
		{ startTime: "09:00:00.000", label: "First service" },
	],
});

const schedule = async (at: string, events: CmsEvent[]) => {
	setSystemTime(new Date(at));
	return firstEvent(await run(SCHEDULE, { slug: events[0]!.slug }, events));
};

describe("event sessions", () => {
	afterEach(() => setSystemTime());

	it("lists every session of a multi-day event and dates the event by the current one", async () => {
		const session = sessionOf("kingdom-culture");
		// Tuesday noon in New York, during the 10:00-12:30 session.
		expect(await schedule("2026-10-06T16:00:00.000Z", [kingdomCulture])).toEqual({
			eventDate: "2026-10-06T10:00:00.000-04:00",
			eventTime: "10:00:00-04:00",
			eventMonth: "October",
			startsAt: new Date("2026-10-05T23:00:00.000Z"),
			endsAt: new Date("2026-10-08T01:00:00.000Z"),
			sessions: [
				session("2026-10-05T23:00:00.000Z", "2026-10-06T01:00:00.000Z", "Opening night"),
				session("2026-10-06T14:00:00.000Z", "2026-10-06T16:30:00.000Z", "Morning"),
				session("2026-10-06T23:00:00.000Z", null, null),
				session("2026-10-07T23:00:00.000Z", "2026-10-08T01:00:00.000Z", "Night three"),
			],
		});
	});

	it("dates a finished multi-day event by its last session", async () => {
		expect(await schedule("2026-10-09T16:00:00.000Z", [kingdomCulture])).toMatchObject({
			eventDate: "2026-10-07T19:00:00.000-04:00",
			eventTime: "19:00:00-04:00",
		});
	});

	it("ends an overnight session on the next day", async () => {
		const watchNight = record({
			slug: "watch-night",
			startDate: "2027-01-01T03:00:00.000Z",
			reoccurring: "One time Event",
			sessions: [
				{
					date: "2026-12-31",
					startTime: "22:00:00.000",
					endTime: "01:00:00.000",
					label: null,
				},
			],
		});
		expect(await schedule("2026-10-06T16:00:00.000Z", [watchNight])).toMatchObject({
			sessions: [
				sessionOf("watch-night")("2027-01-01T03:00:00.000Z", "2027-01-01T06:00:00.000Z", null),
			],
		});
	});

	it("lists each recurring time on the next day the event happens", async () => {
		expect(await schedule("2026-10-06T16:00:00.000Z", [twoServices])).toEqual({
			eventDate: "2026-10-11T09:00:00.000-04:00",
			eventTime: "09:00:00-04:00",
			eventMonth: "October",
			startsAt: new Date("2026-10-11T13:00:00.000Z"),
			endsAt: null,
			sessions: [
				sessionOf("sunday-service")("2026-10-11T13:00:00.000Z", null, "First service"),
				sessionOf("sunday-service")("2026-10-11T15:00:00.000Z", null, "Second service"),
			],
		});
	});

	it("dates a recurring event by its next time that day, in New York time", async () => {
		// Sunday 10:00 in New York, between the two services.
		expect(await schedule("2026-10-11T14:00:00.000Z", [twoServices])).toMatchObject({
			eventDate: "2026-10-11T11:00:00.000-04:00",
			eventTime: "11:00:00-04:00",
		});
		// Daylight saving time ends on Sunday 1 November.
		expect(await schedule("2026-10-28T16:00:00.000Z", [twoServices])).toMatchObject({
			eventDate: "2026-11-01T09:00:00.000-05:00",
			sessions: [
				sessionOf("sunday-service")("2026-11-01T14:00:00.000Z", null, "First service"),
				sessionOf("sunday-service")("2026-11-01T16:00:00.000Z", null, "Second service"),
			],
		});
	});

	it("gives events without a schedule one session from their own dates", async () => {
		expect(await schedule("2026-10-06T16:00:00.000Z", [harvestNight])).toMatchObject({
			startsAt: new Date("2026-11-14T14:00:00.000Z"),
			endsAt: new Date("2026-11-14T17:00:00.000Z"),
			sessions: [
				sessionOf("harvest-night")("2026-11-14T14:00:00.000Z", "2026-11-14T17:00:00.000Z", null),
			],
		});
		expect(await schedule("2026-10-06T16:00:00.000Z", [event])).toMatchObject({
			startsAt: new Date("2026-10-11T14:00:00.000Z"),
			endsAt: null,
			sessions: [sessionOf("sunday-service")("2026-10-11T14:00:00.000Z", null, null)],
		});
	});
});

const RECURRING_TIMES = `query RecurringTimes($slug: String!) {
  events(slug: $slug) { recurringTimes { startTime label } }
}`;

const recurringTimes = async (events: CmsEvent[]) =>
	firstEvent(await run(RECURRING_TIMES, { slug: events[0]!.slug }, events));

describe("event recurring times", () => {
	it("lists a recurring event's times in New York time, earliest first", async () => {
		expect(await recurringTimes([twoServices])).toEqual({
			recurringTimes: [
				{ startTime: "09:00", label: "First service" },
				{ startTime: "11:00", label: "Second service" },
			],
		});
	});

	it("is empty for events without recurring times", async () => {
		expect(await recurringTimes([event])).toEqual({ recurringTimes: [] });
		expect(await recurringTimes([kingdomCulture])).toEqual({ recurringTimes: [] });
	});
});
