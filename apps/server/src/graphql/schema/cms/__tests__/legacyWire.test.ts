import { getCampusGivingPlatforms } from "@/effect/services/giving/platforms";
import { givingText, leadPastorOf, speakerFullName } from "@/graphql/schema/cms/legacyWire";
import { describe, expect, it } from "bun:test";

const leader = (name: string, group: string | null) => ({
	name,
	slug: null,
	group,
	bio: null,
	image: null,
	body: null,
});

describe("givingText", () => {
	it("writes Cash App and Zelle entries in the Strapi 4 text format, in order", () => {
		expect(
			givingText([
				{ platform: "Cashapp", value: "$examplecampus" },
				{ platform: "Zelle", value: "campus@example.org" },
			]),
		).toBe("$examplecampus; Zelle - campus@example.org");
		expect(
			givingText([
				{ platform: "Zelle", value: "praise@example.org" },
				{ platform: "Cashapp", value: "$examplepraise" },
			]),
		).toBe("Zelle - praise@example.org; $examplepraise");
	});

	it("formats Strapi 5 entries and skips other platforms", () => {
		expect(
			givingText([
				{ platform: "Cashapp", value: "https://cash.app/$examplechurch" },
				{ platform: "Zelle", value: "giving@example.org" },
				{ platform: "Givelify", value: "https://givelify.example" },
			]),
		).toBe("$examplechurch; Zelle - giving@example.org");
		expect(
			givingText([{ platform: "Website", value: "https://hccnj.org/giving" }]),
		).toBeUndefined();
	});
});

describe("getCampusGivingPlatforms", () => {
	it("builds the same cards the string parser built", () => {
		expect(
			getCampusGivingPlatforms([
				{ platform: "Cashapp", value: "$examplecampus" },
				{ platform: "Zelle", value: "Campus@example.org" },
			]),
		).toEqual([
			expect.objectContaining({
				title: "Cashapp",
				link: "https://cash.me/$examplecampus",
				text: "Cashapp",
			}),
			expect.objectContaining({ title: "Zelle", text: "campus@example.org" }),
		]);
	});

	it("keeps the last Cash App and the last Zelle entry, Cash App first", () => {
		const giving = [
			{ platform: "Zelle", value: "first@example.org" },
			{ platform: "Cashapp", value: "$first" },
			{ platform: "Zelle", value: "Second@example.org" },
			{ platform: "Cashapp", value: "$second" },
		] as const;
		expect(getCampusGivingPlatforms(giving)).toEqual([
			expect.objectContaining({ title: "Cashapp", link: "https://cash.me/$second" }),
			expect.objectContaining({ title: "Zelle", text: "second@example.org" }),
		]);
	});

	it("includes every Website and Givelify destination, including scheme-less links", () => {
		expect(
			getCampusGivingPlatforms([
				{ platform: "Website", value: "giving.example.org/tithe" },
				{ platform: "Website", value: "https://giving.example.org/donate?fund=missions" },
				{ platform: "Givelify", value: "https://www.givelify.com/givenow/example" },
			]),
		).toEqual([
			expect.objectContaining({
				title: "Website",
				link: "https://giving.example.org/tithe",
				text: "Website",
			}),
			expect.objectContaining({
				title: "Website",
				link: "https://giving.example.org/donate?fund=missions",
				text: "Website",
			}),
			expect.objectContaining({
				title: "Givelify",
				link: "https://www.givelify.com/givenow/example",
				text: "Givelify",
			}),
		]);
	});

	it("exposes an email entered as Website as copyable text", () => {
		expect(
			getCampusGivingPlatforms([{ platform: "Website", value: "campus@example.org" }]),
		).toEqual([
			expect.objectContaining({ title: "Website", link: undefined, text: "campus@example.org" }),
		]);
	});

	it("uses each giving site's PNG icon while preserving Website titles and donation links", () => {
		const links = [
			"https://give.tithe.ly/?formId=example",
			"https://www.paypal.com/donate/?hosted_button_id=example",
		];
		const cards = getCampusGivingPlatforms(links.map((value) => ({ platform: "Website", value })));

		expect(cards.map(({ title, link }) => ({ title, link }))).toEqual(
			links.map((link) => ({ title: "Website", link })),
		);
		expect(cards.map(({ icon }) => icon)).toEqual([
			"https://give.tithe.ly/icon/icon-192x192.png",
			"https://www.paypalobjects.com/webstatic/icon/pp196.png",
		]);
	});

	it("uses the destination icon for the known short links, including query parameters", () => {
		const cards = getCampusGivingPlatforms([
			{ platform: "Website", value: "https://give.tithe.ly/?formId=example" },
			{ platform: "Website", value: "https://bit.ly/Jubilee-Tithely?source=app" },
			{ platform: "Website", value: "tiny.cc/hccgiving" },
		]);

		expect(cards.map(({ icon }) => icon)).toEqual(new Array(3).fill(cards[0]?.icon));
	});

	it("keeps the fallback for unknown sites, other short links, and giving addresses", () => {
		const links = [
			"https://giving.example.org/donate",
			"https://bit.ly/another-campaign",
			"https://tiny.cc/another-campaign",
			"https://paypal.com.example.org/donate",
			"campus@example.org",
		];
		const cards = getCampusGivingPlatforms(links.map((value) => ({ platform: "Website", value })));

		expect(cards[0]?.icon).toContain("hcclogo2.svg");
		expect(cards.map(({ icon }) => icon)).toEqual(new Array(links.length).fill(cards[0]?.icon));
	});
});

describe("speakerFullName", () => {
	it("keeps a name without a title as is", () => {
		expect(speakerFullName({ fullName: "Pastor Bea Example", title: null, image: null })).toBe(
			"Pastor Bea Example",
		);
	});

	it("joins a Strapi 5 name and title", () => {
		expect(
			speakerFullName({ fullName: "Dr.Eli Example", title: "General Overseer", image: null }),
		).toBe("Dr.Eli Example\nGeneral Overseer");
	});
});

describe("leadPastorOf", () => {
	it("prefers a Lead Pastor/Campus Lead, then the first leader", () => {
		expect(
			leadPastorOf([leader("A", "Regional Pastors"), leader("B", "Lead Pastors/Campus Leads")])
				?.name,
		).toBe("B");
		expect(
			leadPastorOf([leader("First", "Regional Pastors"), leader("Second", "Regional Pastors")])
				?.name,
		).toBe("First");
		expect(leadPastorOf([])).toBeUndefined();
	});
});
