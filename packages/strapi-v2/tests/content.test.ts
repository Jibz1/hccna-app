import { describe, expect, it } from "bun:test";
import { Schema } from "effect";

import { EventsData, eventsVariables, toEventRecords } from "../src/queries/events";
import { SermonsData, sermonsVariables, toSermonPage } from "../src/queries/sermons";
import { toThoughtOfGod, TogData } from "../src/queries/thoughtOfGod";

describe("eventsVariables", () => {
	it("includes events with no campus for house-of-stars", () => {
		expect(eventsVariables({ campusSlug: "house-of-stars" })).toEqual({
			filters: {
				and: [
					{
						or: [
							{ campuses: { documentId: { null: true } } },
							{ campuses: { slug: { eq: "house-of-stars" } } },
						],
					},
				],
			},
			sort: [],
		});
	});

	it("filters other campuses by slug only", () => {
		expect(eventsVariables({ campusSlug: "light-house" }).filters).toEqual({
			and: [{ campuses: { slug: { eq: "light-house" } } }],
		});
	});

	// Strapi 5 filters compare the STORED enum value, not the GraphQL name.
	it("filters recurrence with stored display values", () => {
		const variables = eventsVariables({
			campusSlug: "jubilee-place",
			reoccurring: "Daily ",
			slug: "sunday-service",
			upcomingFrom: "2026-10-02",
		});

		expect(variables).toEqual({
			filters: {
				and: [
					{ campuses: { slug: { eq: "jubilee-place" } } },
					{ Reoccurrence: { eq: "Daily" } },
					{ slug: { eq: "sunday-service" } },
					{
						or: [
							{ EventEndDate: { gte: "2026-10-02T00:00:00.000Z" } },
							{ Reoccurrence: { ne: "One time Event" } },
						],
					},
				],
			},
			sort: ["EventStartDate:asc"],
		});
		expect(JSON.stringify(variables)).not.toContain("One_time_Event");
	});
});

const event = (overrides: object = {}) => ({
	slug: "youth-retreat",
	EventName: "Youth Retreat",
	EventStartDate: "2026-11-14T14:00:00.000Z",
	EventEndDate: "2026-11-14T18:30:00.000Z",
	Reoccurrence: "One_time_Event",
	ZoomLink: null,
	body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Join us" }] }] },
	Header: { title: null, description: "A women's gathering", featureImage: { url: "https://img.example/retreat.jpg" } },
	Speaker: [{ FullName: "Pastor Bea Example", Title: " Senior Pastor Example Church ", Image: null }, { FullName: "Guest", Title: "  ", Image: { url: "https://img.example/guest.jpg" } }],
	// Events saved before the schedule fields existed answer null for the switch.
	Sessions: [],
	MultipleTimes: null,
	RecurringTimes: [],
	...overrides,
});

describe("event records", () => {
	it("maps a Strapi 5 event to the record the server reads", () => {
		const [record] = toEventRecords(Schema.decodeUnknownSync(EventsData)({ events: [event()] }));

		expect(record).toEqual({
			slug: "youth-retreat",
			pageName: "Youth Retreat",
			eventTitle: "Youth Retreat",
			description: "A women's gathering",
			body: JSON.stringify({ time: 0, blocks: [{ id: "block-0", type: "paragraph", data: { text: "Join us" } }], version: "2.31.0" }),
			content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Join us" }] }] },
			startDate: "2026-11-14T14:00:00.000Z",
			endDate: "2026-11-14T18:30:00.000Z",
			reoccurring: "One time Event",
			room: null,
			zoomLink: null,
			speakers: [
				{ fullName: "Pastor Bea Example", title: "Senior Pastor Example Church", image: null },
				{ fullName: "Guest", title: null, image: "https://img.example/guest.jpg" },
			],
			imageUrl: "https://img.example/retreat.jpg",
			sessions: [],
			recurringTimes: [],
		});
	});

	it("keeps the sessions of a one-time event and ignores hidden recurring times", () => {
		const [record] = toEventRecords(
			Schema.decodeUnknownSync(EventsData)({
				events: [
					event({
						Sessions: [
							{ Date: "2026-11-15", StartTime: "10:00:00.000", EndTime: null, Label: "Day two" },
							{ Date: "2026-11-14", StartTime: "19:00:00.000", EndTime: "21:30:00.000", Label: " Opening night " },
							{ Date: null, StartTime: "08:00:00.000", EndTime: null, Label: null },
						],
						MultipleTimes: true,
						RecurringTimes: [{ StartTime: "09:00:00.000", Label: null }],
					}),
				],
			}),
		);

		expect(record?.sessions).toEqual([
			{ date: "2026-11-15", startTime: "10:00:00.000", endTime: null, label: "Day two" },
			{ date: "2026-11-14", startTime: "19:00:00.000", endTime: "21:30:00.000", label: "Opening night" },
		]);
		expect(record?.recurringTimes).toEqual([]);
	});

	it("treats an event without a recurrence as one-time, like the server does", () => {
		const [record] = toEventRecords(
			Schema.decodeUnknownSync(EventsData)({
				events: [
					event({
						Reoccurrence: null,
						Sessions: [{ Date: "2026-11-14", StartTime: "19:00:00.000", EndTime: null, Label: null }],
						MultipleTimes: true,
						RecurringTimes: [{ StartTime: "09:00:00.000", Label: null }],
					}),
				],
			}),
		);

		expect(record?.sessions).toEqual([{ date: "2026-11-14", startTime: "19:00:00.000", endTime: null, label: null }]);
		expect(record?.recurringTimes).toEqual([]);
	});

	it("keeps recurring times only while multiple times is on", () => {
		const weekly = (MultipleTimes: boolean | null) =>
			event({
				Reoccurrence: "Weekly",
				Sessions: [{ Date: "2026-11-14", StartTime: "19:00:00.000", EndTime: null, Label: null }],
				MultipleTimes,
				RecurringTimes: [
					{ StartTime: "11:00:00.000", Label: "Second service" },
					{ StartTime: "09:00:00.000", Label: "  " },
					{ StartTime: null, Label: "Unscheduled" },
				],
			});
		const [on, off, unset] = toEventRecords(
			Schema.decodeUnknownSync(EventsData)({ events: [weekly(true), weekly(false), weekly(null)] }),
		);

		expect(on?.recurringTimes).toEqual([
			{ startTime: "11:00:00.000", label: "Second service" },
			{ startTime: "09:00:00.000", label: null },
		]);
		expect(on?.sessions).toEqual([]);
		expect(off?.recurringTimes).toEqual([]);
		expect(unset?.recurringTimes).toEqual([]);
	});

	it("skips events without a slug or a start date", () => {
		const records = toEventRecords(
			Schema.decodeUnknownSync(EventsData)({
				events: [event({ slug: null }), event({ slug: "no-date", EventStartDate: null }), event({ slug: "kept" })],
			}),
		);
		expect(records.map((record) => record.slug)).toEqual(["kept"]);
	});
});

describe("sermons", () => {
	it("builds slug and cursor variables", () => {
		expect(sermonsVariables({ kind: "slugs", slugs: ["a", "b"] })).toEqual({
			filters: { slug: { in: ["a", "b"] } },
			sort: ["date:desc"],
			pageSize: 100,
		});
		expect(sermonsVariables({ kind: "page", pageSize: 11 })).toEqual({
			filters: {},
			sort: ["date:desc", "slug:desc"],
			pageSize: 11,
		});
	});

	// Several sermons can share a date, so a date-only cursor skips the rest of that day.
	it("continues within the cursor's date by slug", () => {
		const cursor = { date: "2026-01-01", slug: "sample-sermon-2" };
		expect(sermonsVariables({ kind: "page", pageSize: 11, after: cursor })).toEqual({
			filters: {
				or: [{ date: { lt: "2026-01-01" } }, { date: { eq: "2026-01-01" }, slug: { lt: "sample-sermon-2" } }],
			},
			sort: ["date:desc", "slug:desc"],
			pageSize: 11,
		});
		expect(sermonsVariables({ kind: "page", pageSize: 11, before: cursor })).toEqual({
			filters: {
				or: [{ date: { gt: "2026-01-01" } }, { date: { eq: "2026-01-01" }, slug: { gt: "sample-sermon-2" } }],
			},
			sort: ["date:asc", "slug:asc"],
			pageSize: 11,
		});
	});

	it("maps sermons and the sermon page metadata", () => {
		const data = Schema.decodeUnknownSync(SermonsData)({
			sermons: [
				{
					slug: "sample-sermon-1",
					Title: "Sample Sermon Title",
					date: "2026-08-20",
					YoutubeLink: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
					Thumbnail: { url: "https://img.example/sermon.webp" },
					Speaker: { FullName: "Dr. Cal Example ", Title: "Senior Pastor Example Church", Image: null },
				},
				{ slug: null, Title: "Dropped", date: null, YoutubeLink: null, Thumbnail: null, Speaker: null },
			],
			sermonPage: { Intro: { title: null, description: null, featureImage: { url: "https://img.example/page.png" } }, body: null },
		});

		expect(toSermonPage(data)).toEqual({
			items: [
				{
					slug: "sample-sermon-1",
					title: "Sample Sermon Title",
					date: "2026-08-20",
					thumbnail: "https://img.example/sermon.webp",
					speaker: { fullName: "Dr. Cal Example ", title: "Senior Pastor Example Church", image: null },
					youtubeLink: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
					pageName: "Sample Sermon Title",
				},
			],
			featuredImg: "https://img.example/page.png",
			body: null,
		});
	});
});

describe("thought of god", () => {
	it("maps blogs and videos with no blog dates", () => {
		const data = Schema.decodeUnknownSync(TogData)({
			tog: {
				Heading: { title: "Thought Of God", description: "Daily", featureImage: null },
				TOGBlogs: [{ Title: "Faith", Description: "On faith", BlogLink: "https://blog.example/faith", Thumbnail: null }],
				Youtube: [{ YoutubeLink: "https://youtu.be/x", VideoName: "Sample Video", description: "Sermon", Thumbname: { url: "https://img.example/t.jpg" } }],
			},
		});

		expect(toThoughtOfGod(data)).toEqual({
			title: "Thought Of God",
			description: "Daily",
			thumbnail: null,
			blogs: [{ title: "Faith", description: "On faith", link: "https://blog.example/faith", date: null, thumbnail: null }],
			youtube: [{ youtubeLink: "https://youtu.be/x", title: "Sample Video", thumbnail: "https://img.example/t.jpg", body: "Sermon" }],
		});
	});

	it("returns null when the tog single type is missing", () => {
		expect(toThoughtOfGod(Schema.decodeUnknownSync(TogData)({ tog: null }))).toBeNull();
	});
});
