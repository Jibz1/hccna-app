import { describe, expect, it } from "bun:test";
import { Schema } from "effect";

import { CampusesData, toCampusRecords } from "../src/queries/campuses";
import { CoreData, toCoreSections } from "../src/queries/coreSections";
import { CampusCardsData, HomeCardsData, toCampusCards, toHomeCards } from "../src/queries/featuredCards";

const editorJs = { time: 1, blocks: [{ type: "paragraph", data: { text: "Welcome" } }], version: "2.28.0" };

const campus = (overrides: object = {}) => ({
	slug: "house-of-stars",
	CampusName: "House of Stars",
	Phone: "555-0100",
	Address: "1 Main St",
	CityState: "Newark, NJ",
	FacebookChannelLink: null,
	InstagramChannelLink: "https://instagram.example/hccnj",
	LiveStreamChannelLink: "https://live.example/hccnj",
	body: editorJs,
	Header: { title: "House of Stars", description: "Main campus", featureImage: { url: "https://img.example/hos.jpg" } },
	Stream: { CastrID: "castr-1" },
	GivingPlatforms: [
		{ Platform: "Cashapp", link: "https://cash.app/$examplechurch" },
		{ Platform: "Zelle", link: " giving@example.com " },
		{ Platform: "Website", link: null },
	],
	leaderships: [
		{
			PageName: "Pastor Ada Example",
			slug: "pastor-ada-example",
			Heading: { featureImage: { url: "https://img.example/heading.jpg" } },
			Leader: { LeadershipGroup: "Regional_Pastors", BioIntro: "Regional Pastor", body: null, ProfilePicture: null },
		},
	],
	...overrides,
});

const decodeCampuses = (campuses: object[]) => Schema.decodeUnknownSync(CampusesData)({ campuses });

describe("campus records", () => {
	it("maps a Strapi 5 campus to the record the server reads", () => {
		const [record] = toCampusRecords(decodeCampuses([campus()]));

		expect(record).toEqual({
			slug: "house-of-stars",
			name: "House of Stars",
			description: "Main campus",
			image: "https://img.example/hos.jpg",
			phone: "555-0100",
			address: "1 Main St",
			cityState: "Newark, NJ",
			facebook: null,
			instagram: "https://instagram.example/hccnj",
			streamLink: "https://live.example/hccnj",
			castrStreamId: "castr-1",
			body: JSON.stringify({ ...editorJs, blocks: [{ id: "block-0", ...editorJs.blocks[0] }] }),
			content: {
				type: "doc",
				attrs: { schemaVersion: 1 },
				content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome" }] }],
			},
			giving: [
				{ platform: "Cashapp", value: "https://cash.app/$examplechurch" },
				{ platform: "Zelle", value: "giving@example.com" },
			],
			leaders: [
				{
					name: "Pastor Ada Example",
					slug: "pastor-ada-example",
					group: "Regional Pastors",
					bio: "Regional Pastor",
					image: "https://img.example/heading.jpg",
					body: null,
				},
			],
		});
	});

	it("skips campuses without a slug and tolerates missing components", () => {
		const records = toCampusRecords(
			decodeCampuses([
				campus({ slug: null }),
				campus({ slug: "place-of-power", Header: null, Stream: null, GivingPlatforms: null, leaderships: [] }),
			]),
		);

		expect(records.map((record) => record.slug)).toEqual(["place-of-power"]);
		expect(records[0]?.description).toBeNull();
		expect(records[0]?.image).toBeNull();
		expect(records[0]?.castrStreamId).toBeNull();
		expect(records[0]?.giving).toEqual([]);
	});

	it("keeps one title line from a leader's bio intro, without repeating the name", () => {
		const leader = (PageName: string, BioIntro: string) => ({
			PageName,
			slug: "lead",
			Heading: null,
			Leader: { LeadershipGroup: "Lead_Pastors_Campus_Leads", BioIntro, body: null, ProfilePicture: null },
		});
		const [record] = toCampusRecords(
			decodeCampuses([
				campus({
					leaderships: [
						leader("Pastor Jane Doe", "Lead Pastor: Jane Doe\n\nHouse of Grace\n\nPhone: 555-0100"),
						leader("Pastor Sam Sample", "  Lead Pastor  HCC North Region "),
						leader("Pastor Ada Example", "\n\nRegional Pastor\nNewark"),
						leader("Pastor Empty", "   "),
					],
				}),
			]),
		);

		expect(record?.leaders.map((item) => item.bio)).toEqual([
			"Lead Pastor",
			"Lead Pastor HCC North Region",
			"Regional Pastor",
			null,
		]);
	});

	// Strapi 5 requires Address, so campuses without one hold a placeholder like "-".
	it("treats a placeholder address as missing so the city and state show instead", () => {
		const records = toCampusRecords(
			decodeCampuses([
				campus({ slug: "house-of-grace", Address: "-", CityState: "Springfield, IL" }),
				campus({ slug: "dashes", Address: " — ", CityState: " - " }),
				campus({ slug: "place-of-power", Address: "Example City, ON", CityState: "Example City, ON" }),
			]),
		);

		expect(records.map(({ slug, address, cityState }) => ({ slug, address, cityState }))).toEqual([
			{ slug: "house-of-grace", address: null, cityState: "Springfield, IL" },
			{ slug: "dashes", address: null, cityState: null },
			{ slug: "place-of-power", address: "Example City, ON", cityState: "Example City, ON" },
		]);
	});

	it("rejects an unknown leadership group during decoding", () => {
		const bad = campus({
			leaderships: [{ PageName: "X", slug: "x", Heading: null, Leader: { LeadershipGroup: "Elders", BioIntro: null, body: null, ProfilePicture: null } }],
		});
		expect(() => decodeCampuses([bad])).toThrow();
	});
});

const card = (overrides: object = {}) => ({
	id: "58",
	EventName: "SUMMIT",
	Description: "Conference",
	pagetLink: "https://church.example/news-and-events/summit-conference",
	allCampusEvent: null,
	FeatureImage: { url: "https://img.example/summit.jpg" },
	...overrides,
});

describe("featured cards", () => {
	it("maps home cards, numeric ids and a null all-campus flag", () => {
		const data = Schema.decodeUnknownSync(HomeCardsData)({ home: { FeaturedEvents: [card(), card({ id: "x", allCampusEvent: true, FeatureImage: null })] } });

		expect(toHomeCards(data)).toEqual([
			{
				sourceId: 58,
				eventTitle: "SUMMIT",
				description: "Conference",
				imageUrl: "https://img.example/summit.jpg",
				pageLink: "https://church.example/news-and-events/summit-conference",
				allCampusEvent: false,
			},
			{
				sourceId: null,
				eventTitle: "SUMMIT",
				description: "Conference",
				imageUrl: null,
				pageLink: "https://church.example/news-and-events/summit-conference",
				allCampusEvent: true,
			},
		]);
	});

	it("returns null when the home single type is missing", () => {
		expect(toHomeCards(Schema.decodeUnknownSync(HomeCardsData)({ home: null }))).toBeNull();
	});

	it("reads only the requested campus's cards", () => {
		const data = Schema.decodeUnknownSync(CampusCardsData)({
			campuses: [
				{ slug: "new-breed", CampusFeatureEvent: [card({ id: "47", EventName: "Sunday Service" })] },
				{ slug: "jubilee-place", CampusFeatureEvent: null },
			],
		});

		expect(toCampusCards(data, "new-breed").map((item) => item.eventTitle)).toEqual(["Sunday Service"]);
		expect(toCampusCards(data, "jubilee-place")).toEqual([]);
		expect(toCampusCards(data, "light-house")).toEqual([]);
	});

	it("maps campus cards, which have no all-campus flag, as local only", () => {
		const { allCampusEvent: _, ...campusCard } = card();
		const data = Schema.decodeUnknownSync(CampusCardsData)({ campuses: [{ slug: "new-breed", CampusFeatureEvent: [campusCard] }] });

		expect(toCampusCards(data, "new-breed")).toEqual([
			{
				sourceId: 58,
				eventTitle: "SUMMIT",
				description: "Conference",
				imageUrl: "https://img.example/summit.jpg",
				pageLink: "https://church.example/news-and-events/summit-conference",
				allCampusEvent: false,
			},
		]);
	});
});

describe("core sections", () => {
	it("maps the three app-config sections and leaves the others undefined", () => {
		const data = Schema.decodeUnknownSync(CoreData)({
			appConfig: {
				Giving: { Intro: "Give", FeatureImage: { url: "https://img.example/give.jpg" } },
				More: { Intro: "More", FeatureImage: null },
				HCCexpression: null,
			},
		});

		const sections = toCoreSections(data);

		expect(sections).toEqual({
			giving: { copy: "Give", image: "https://img.example/give.jpg" },
			more: { copy: "More", image: null },
			hccexpression: { copy: null, image: null },
		});
		expect(sections !== null && "profile" in sections).toBe(false);
	});

	it("returns null when app-config is missing", () => {
		expect(toCoreSections(Schema.decodeUnknownSync(CoreData)({ appConfig: null }))).toBeNull();
	});
});
