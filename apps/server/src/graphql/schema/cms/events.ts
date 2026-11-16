import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { speakerFullName } from "@/graphql/schema/cms/legacyWire";
import { capitalizeText } from "@/utils/capitalizeText";
import { getNextOccurrence } from "@/utils/events";
import { currentSession, eventSessions } from "@/utils/eventSessions";
import { RecurrenceCalculator, type RecurringType } from "@/utils/recurrenceCalculator";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Effect } from "effect";
import { DateTime } from "luxon";

import type { GraphQLContext } from "@/graphql/context";
import type { CmsEvent, CmsEventsFilter, RichDocument } from "@hccnj/strapi-v2";

interface EventSpeaker {
	fullName?: string | undefined;
	image?: string | undefined;
}

interface EventSession {
	id: string;
	startsAt: Date;
	endsAt: Date | null;
	label: string | null;
}

interface EventRecurringTime {
	startTime: string;
	label: string | null;
}

interface Event {
	pageTitle: string;
	eventTitle: string;
	description: string | null;
	body: string | null | undefined;
	content: RichDocument | null;
	eventImageUrl: string;
	pageName: string;
	reoccurring?: string | undefined;
	eventDate: string;
	room?: string | undefined;
	eventTime: string;
	slug: string;
	eventSpeakers?: EventSpeaker[] | undefined;
	zoomLink?: string | undefined;
	// nextEventDate: string;
	eventMonth: string;
	sessions: EventSession[];
	startsAt: Date | null;
	endsAt: Date | null;
	recurringTimes: EventRecurringTime[];
}

const SpeakerRef = builder.objectRef<EventSpeaker>("EventSpeaker").implement({
	fields: (t) => ({
		fullName: t.exposeString("fullName", {
			nullable: true,
		}),
		image: t.exposeString("image", {
			nullable: true,
		}),
	}),
});

const EventSessionRef = builder.objectRef<EventSession>("EventSession").implement({
	description:
		"One time an event happens. Times are instants; the church schedules them in New York time.",
	fields: (t) => ({
		id: t.exposeID("id", {
			nullable: false,
			description:
				"The event slug and the session start, e.g. sunday-service@2026-10-11T13:00:00.000Z",
		}),
		startsAt: t.expose("startsAt", { type: "DateTime", nullable: false }),
		endsAt: t.expose("endsAt", {
			type: "DateTime",
			nullable: true,
			description: "Null when the session has no end time",
		}),
		label: t.exposeString("label", {
			nullable: true,
			description: 'The editor\'s name for the session, e.g. "Opening night"',
		}),
	}),
});

const EventRecurringTimeRef = builder
	.objectRef<EventRecurringTime>("EventRecurringTime")
	.implement({
		description: "A start time on every day a recurring event happens",
		fields: (t) => ({
			startTime: t.exposeString("startTime", {
				nullable: false,
				description: 'New York wall-clock time, 24-hour "HH:mm", e.g. "09:00"',
			}),
			label: t.exposeString("label", {
				nullable: true,
				description: 'The editor\'s name for the time, e.g. "First service"',
			}),
		}),
	});

// const ReoccurringEnum = builder.enumType('Reoccurring', {
// 	values: ['One time Event', 'Daily ', 'Weekly', 'BiWeekly', 'Monthly', 'Twice a month'] as const,
// });

enum ReoccurringEnum {
	ONE_TIME_EVENT = "One time Event",
	DAILY = "Daily ",
	WEEKLY = "Weekly",
	BI_WEEKLY = "BiWeekly",
	MONTHLY = "Monthly",
	TWICE_A_MONTH = "Twice a month",
}

const ReoccurringEnumBuilder = builder.enumType(ReoccurringEnum, {
	name: "Reoccurring",
});

const EventRef = builder.objectRef<Event>("Event").implement({
	fields: (t) => ({
		pageTitle: t.exposeString("pageTitle"),
		eventTitle: t.exposeString("eventTitle"),
		description: t.exposeString("description"),
		body: t.exposeString("body"),
		content: t.field({
			type: "JSON",
			nullable: true,
			description:
				"The event page's rich text as a Tiptap document (paragraphs, headings, nested lists, marks, media), or null when the page has none. Prefer it over body, the EditorJS JSON string installed apps render.",
			resolve: (root) => root.content,
		}),
		eventImageUrl: t.exposeString("eventImageUrl"),
		pageName: t.exposeString("pageName"),
		reoccurring: t.exposeString("reoccurring"),
		eventDate: t.exposeString("eventDate"),
		room: t.exposeString("room", {
			nullable: true,
			description: "Event room",
		}),
		eventTime: t.exposeString("eventTime"),
		slug: t.exposeString("slug"),
		//nextEventDate: t.exposeString('nextEventDate'),
		eventMonth: t.exposeString("eventMonth"),
		eventSpeakers: t.field({
			type: [SpeakerRef],
			resolve: (root) => root.eventSpeakers,
			nullable: true,
		}),
		zoomLink: t.exposeString("zoomLink", {
			nullable: true,
		}),
		sessions: t.field({
			type: [EventSessionRef],
			nullable: { list: false, items: false },
			description:
				"When the event happens, soonest first: every session of a one-time event, or each time on a recurring event's next day. Events without a schedule have one session from their own dates. eventDate, eventTime and eventMonth describe the first session that has not finished.",
			resolve: (root) => root.sessions,
		}),
		startsAt: t.expose("startsAt", {
			type: "DateTime",
			nullable: true,
			description: "When the first session starts",
		}),
		endsAt: t.expose("endsAt", {
			type: "DateTime",
			nullable: true,
			description: "When the last session ends; null when it has no end time",
		}),
		recurringTimes: t.field({
			type: [EventRecurringTimeRef],
			nullable: { list: false, items: false },
			description:
				"Each time on every day a recurring event happens, earliest first, from the CMS RecurringTimes. Empty for one-time events and while the CMS MultipleTimes switch is off.",
			resolve: (root) => root.recurringTimes,
		}),
	}),
});

const UPCOMING_EVENTS_PAGE_SLUG = "UPCOMING-EVENTS";

const DEFAULT_EVENT_CAMPUS = "house-of-stars";

const loadEvents = (ctx: GraphQLContext, filter: CmsEventsFilter) =>
	ctx.effect.runPromise(
		Effect.gen(function* () {
			const cms = yield* CmsContent;
			return yield* cms.events(filter);
		}),
	);

const mapEventRecord = (record: CmsEvent): Event => {
	const eventDateValue = record.startDate;
	const eventDateTime = DateTime.fromISO(eventDateValue);
	const normalizedReoccurring = record.reoccurring?.trim() as RecurringType | undefined;
	const nextEventDate = RecurrenceCalculator.getNextOccurrence(
		eventDateTime,
		normalizedReoccurring ?? "One time Event",
	);
	const { scheduled, sessions } = eventSessions(record, nextEventDate);
	// An event with a schedule is dated by its session in progress or next; others as before.
	const dated = scheduled
		? (currentSession(sessions, DateTime.now())?.startsAt.setZone("America/New_York") ??
			nextEventDate)
		: nextEventDate;
	const datedJson = dated.toJSON();

	const pageName = capitalizeText((record.pageName ?? "").trim());
	const eventTitle = capitalizeText((record.eventTitle ?? "").trim());

	const { eventTime, eventDate, eventMonth } = datedJson
		? {
				eventTime: formatInTimeZone(dated.toJSDate(), "America/New_York", "HH:mm:ssXXX"),
				eventDate: datedJson,
				eventMonth: dated.toFormat("MMMM"),
			}
		: getNextOccurrence({
				date: eventDateValue,
				reoccurring: (record.reoccurring ?? "One time Event") as Parameters<
					typeof getNextOccurrence
				>[0]["reoccurring"],
				withTime: true,
			});

	return {
		pageTitle: pageName,
		eventTitle,
		description: record.description,
		body: record.body?.replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&nbsp;", " "),
		content: record.content,
		eventImageUrl: record.imageUrl || "",
		pageName,
		reoccurring: record.reoccurring ?? undefined,
		room: record.room ?? undefined,
		slug: record.slug,
		eventSpeakers: record.speakers?.map((speaker) => ({
			fullName: speakerFullName(speaker) ?? undefined,
			image: speaker.image ?? undefined,
		})),
		zoomLink: record.zoomLink ?? undefined,
		eventTime,
		eventDate,
		eventMonth,
		sessions: sessions.map((session) => ({
			id: `${record.slug}@${session.startsAt.toUTC().toISO()}`,
			startsAt: session.startsAt.toJSDate(),
			endsAt: session.endsAt?.toJSDate() ?? null,
			label: session.label,
		})),
		startsAt: sessions[0]?.startsAt.toJSDate() ?? null,
		endsAt: sessions.at(-1)?.endsAt?.toJSDate() ?? null,
		// "HH:mm" sorts chronologically as text.
		recurringTimes: record.recurringTimes
			.flatMap(({ startTime, label }) => {
				const clock = /^(?:[01]\d|2[0-3]):[0-5]\d/u.exec(startTime)?.[0];
				return clock === undefined ? [] : [{ startTime: clock, label }];
			})
			.toSorted((a, b) => a.startTime.localeCompare(b.startTime)),
	};
};

builder.queryField("events", (t) =>
	t.field({
		type: [EventRef],
		authScopes: authScope.authorized,
		description:
			"Get events from Strapi. If slug is provided, returns a single event. If reoccurring is provided, filters events by reoccurring type.",
		deprecationReason:
			"Use upcomingEventsByMonth instead, which groups upcoming events by month and returns typed success/error responses. The slug argument for single-event lookup has no replacement yet.",
		args: {
			campusSlug: t.arg.string({
				description:
					"Campus slug. Defaults to house-of-stars, which also includes events without a campus. Other campuses include only events assigned to that campus.",
				required: false,
			}),
			slug: t.arg.string({
				description: "Event slug",
				required: false,
			}),
			reoccurring: t.arg({
				type: ReoccurringEnumBuilder,
				required: false,
			}),
		},
		resolve: async (_, { campusSlug, slug, reoccurring }, ctx) => {
			try {
				const records = await loadEvents(ctx, {
					campusSlug: campusSlug?.trim() || DEFAULT_EVENT_CAMPUS,
					reoccurring: reoccurring ?? undefined,
					slug: slug ?? undefined,
					upcomingFrom: slug ? undefined : format(new Date(), "yyyy-MM-dd"),
				});

				const events = records
					.filter((record) => record.slug !== UPCOMING_EVENTS_PAGE_SLUG)
					.map((record) => mapEventRecord(record));

				if (!slug && events.length > 1) {
					events.sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
				}

				return events;
			} catch (error) {
				console.error(error);
				throw new Error("Error fetching events", { cause: error });
			}
		},
	}),
);

interface EventMonthGroup {
	month: string;
	year: number;
	events: Event[];
}

interface UpcomingEventsByMonthSuccess {
	_tag: "UpcomingEventsByMonthSuccess";
	months: EventMonthGroup[];
}

interface UpcomingEventsByMonthFetchError {
	_tag: "UpcomingEventsByMonthFetchError";
	message: string;
}

type UpcomingEventsByMonthResult = UpcomingEventsByMonthSuccess | UpcomingEventsByMonthFetchError;

const EventMonthGroupType = builder.objectRef<EventMonthGroup>("EventMonthGroup").implement({
	fields: (t) => ({
		month: t.exposeString("month", {
			description: 'Full month name, e.g. "August"',
		}),
		year: t.exposeInt("year", {
			description: "Calendar year the month belongs to",
		}),
		events: t.field({
			type: [EventRef],
			description: "Events occurring in this month, soonest first",
			resolve: (root) => root.events,
		}),
	}),
});

const UpcomingEventsByMonthSuccessType = builder
	.objectRef<UpcomingEventsByMonthSuccess>("UpcomingEventsByMonthSuccess")
	.implement({
		fields: (t) => ({
			months: t.field({
				type: [EventMonthGroupType],
				description: "Upcoming events grouped by month in chronological order",
				resolve: (root) => root.months,
			}),
		}),
	});

const UpcomingEventsByMonthFetchErrorType = builder
	.objectRef<UpcomingEventsByMonthFetchError>("UpcomingEventsByMonthFetchError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message describing what went wrong",
			}),
		}),
	});

const UpcomingEventsByMonthResultType = builder.unionType("UpcomingEventsByMonthResult", {
	types: [UpcomingEventsByMonthSuccessType, UpcomingEventsByMonthFetchErrorType],
	resolveType: (value) => {
		switch (value._tag) {
			case "UpcomingEventsByMonthSuccess": {
				return UpcomingEventsByMonthSuccessType;
			}
			case "UpcomingEventsByMonthFetchError": {
				return UpcomingEventsByMonthFetchErrorType;
			}
		}
	},
});

const groupEventsByMonth = (events: Event[]): EventMonthGroup[] => {
	const sortedEvents = events.toSorted(
		(a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
	);

	const groups = new Map<string, EventMonthGroup>();
	for (const event of sortedEvents) {
		const eventDate = new Date(event.eventDate);
		const month = formatInTimeZone(eventDate, "America/New_York", "MMMM");
		const year = Number(formatInTimeZone(eventDate, "America/New_York", "yyyy"));
		const key = `${year}-${month}`;

		const group = groups.get(key);
		if (group) {
			group.events.push(event);
		} else {
			groups.set(key, { month, year, events: [event] });
		}
	}

	return [...groups.values()];
};

const toEventsFetchMessage = (cause: unknown) =>
	cause instanceof Error ? cause.message : "Failed to fetch upcoming events";

/**
 * Resolver for upcomingEventsByMonth GraphQL field.
 * Returns typed success/error objects following the myGivingHistory response style.
 */
const resolveUpcomingEventsByMonth = async (
	ctx: GraphQLContext,
	campusSlug?: string | null,
): Promise<UpcomingEventsByMonthResult> => {
	try {
		const records = await loadEvents(ctx, {
			campusSlug: campusSlug?.trim() || DEFAULT_EVENT_CAMPUS,
			upcomingFrom: format(new Date(), "yyyy-MM-dd"),
		});

		const events = records
			.filter((record) => record.slug !== UPCOMING_EVENTS_PAGE_SLUG)
			.map((record) => mapEventRecord(record));

		return {
			_tag: "UpcomingEventsByMonthSuccess",
			months: groupEventsByMonth(events),
		};
	} catch (error) {
		return {
			_tag: "UpcomingEventsByMonthFetchError",
			message: toEventsFetchMessage(error),
		};
	}
};

builder.queryField("upcomingEventsByMonth", (t) =>
	t.field({
		type: UpcomingEventsByMonthResultType,
		authScopes: authScope.authorized,
		description: "Get upcoming events grouped by month with typed success and error responses",
		args: {
			campusSlug: t.arg.string({
				description:
					"Campus slug. Defaults to house-of-stars, which also includes events without a campus. Other campuses include only events assigned to that campus.",
				required: false,
			}),
		},
		resolve: (_, { campusSlug }, ctx) => resolveUpcomingEventsByMonth(ctx, campusSlug),
	}),
);
