import { CmsContent, CmsContentError } from "@/effect/services/cms/content/CmsContent";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { createMockContext } from "@/graphql/__tests__/utils/test-context";
import { schema } from "@/graphql/schema";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { execute, parse } from "graphql";

import type { CmsCampus } from "@hccnj/strapi-v2";

const campus: CmsCampus = {
	slug: "new-breed",
	name: "New Breed",
	description: null,
	image: null,
	phone: null,
	address: null,
	cityState: "Example City, TX",
	facebook: null,
	instagram: null,
	streamLink: null,
	castrStreamId: null,
	body: null,
	content: null,
	giving: [],
	leaders: [],
};

const contextWith = (
	campuses: Effect.Effect<readonly CmsCampus[], CmsContentError>,
	logs = captureLogs(),
) => {
	const cms = { campuses } as never;
	return createMockContext({
		authorized: true,
		authType: "jwt",
		currentUserUid: "u",
		currentUserEmail: "u@example.com",
		effectRunPromise: (<A, E, R>(program: Effect.Effect<A, E, R>) =>
			Effect.runPromise(
				(program as Effect.Effect<A, E, CmsContent>).pipe(
					Effect.provideService(CmsContent, cms),
					Effect.provide(logs.layer),
				),
			)) as never,
	});
};

describe("campusesV2", () => {
	it("returns an empty description instead of failing every campus", async () => {
		const result = await execute({
			schema,
			document: parse(
				"query { campusesV2 { __typename ... on CampusesSuccess { campuses { slug description } } } }",
			),
			contextValue: contextWith(Effect.succeed([campus])),
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			campusesV2: {
				__typename: "CampusesSuccess",
				campuses: [{ slug: "new-breed", description: "" }],
			},
		});
	});

	it("exposes the rich text content the app renders next to the EditorJS body", async () => {
		const content = {
			type: "doc" as const,
			content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome" }] }],
		};
		const result = await execute({
			schema,
			document: parse(
				"query { campusesV2 { __typename ... on CampusesSuccess { campuses { slug body content } } } }",
			),
			contextValue: contextWith(Effect.succeed([{ ...campus, body: "{}", content }])),
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			campusesV2: {
				__typename: "CampusesSuccess",
				campuses: [{ slug: "new-breed", body: "{}", content }],
			},
		});
	});

	it("answers its typed error and logs the CMS failure behind it", async () => {
		const failure = new CmsContentError({
			reason: "Malformed",
			operation: "campuses",
			detail: 'Strapi 5 StrapiV2Campuses failed (Decode): Expected string\n  at ["campuses"][0]',
		});
		const logs = captureLogs();

		const result = await execute({
			schema,
			document: parse("query { campusesV2 { __typename ... on CampusesFetchError { message } } }"),
			contextValue: contextWith(Effect.fail(failure), logs),
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			campusesV2: { __typename: "CampusesFetchError", message: "Unable to load campuses" },
		});
		const annotations = { reason: failure.reason, detail: failure.detail };
		expect(logs.lines).toEqual([
			`Error CMS fetch: Unable to load campuses ${JSON.stringify(annotations)}`,
		]);
	});
});

const lead = (
	name: string | null,
	slug: string | null,
	group: string | null = "Lead Pastors/Campus Leads",
): CmsCampus["leaders"][number] => ({ name, slug, group, bio: null, image: null, body: null });

const LEADS_QUERY = parse(`query {
	campuses { campus { campusLead { name } leadPastor { name } } }
	campusesV2 { ... on CampusesSuccess { campuses {
		campusLead { name }
		leadPastor { name }
		campusLeads: leadPastor { slug name image subTitle }
	} } }
}`);

describe("campus leads", () => {
	it("includes both House of Stars regional pastors without changing the singular lead", async () => {
		const leaders = [
			lead("Pastor Ada Example", "pastor-ada-example", "Regional Pastors"),
			lead("Pastor Ben Example", "pastor-ben-example", "Regional Pastors"),
			lead("Minister", "minister", "Ministers"),
		];
		const result = await execute({
			schema,
			document: LEADS_QUERY,
			contextValue: contextWith(Effect.succeed([{ ...campus, slug: "house-of-stars", leaders }])),
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			campuses: {
				campus: [
					{
						campusLead: { name: "Pastor Ada Example" },
						leadPastor: [{ name: "Pastor Ada Example" }, { name: "Pastor Ben Example" }],
					},
				],
			},
			campusesV2: {
				campuses: [
					{
						campusLead: { name: "Ada Example" },
						leadPastor: [{ name: "Ada Example" }, { name: "Ben Example" }],
						campusLeads: [
							{ slug: "pastor-ada-example", name: "Ada Example", image: null, subTitle: null },
							{ slug: "pastor-ben-example", name: "Ben Example", image: null, subTitle: null },
						],
					},
				],
			},
		});
	});

	it("returns all campus leads in CMS order while preserving the singular selection", async () => {
		const leaders = [
			lead("Regional Pastor", "regional", "Regional Pastors"),
			{
				...lead(" Pastor First Lead ", "first"),
				image: "https://example.com/first.jpg",
				bio: "First bio",
			},
			lead("Dr. Second Lead", "second"),
			lead("Minister", "minister", "Ministers"),
		];
		const result = await execute({
			schema,
			document: LEADS_QUERY,
			contextValue: contextWith(Effect.succeed([{ ...campus, leaders }])),
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			campuses: {
				campus: [
					{
						campusLead: { name: " Pastor First Lead " },
						leadPastor: [{ name: " Pastor First Lead " }, { name: "Dr. Second Lead" }],
					},
				],
			},
			campusesV2: {
				campuses: [
					{
						campusLead: { name: "First Lead" },
						leadPastor: [{ name: "First Lead" }, { name: "Second Lead" }],
						campusLeads: [
							{
								slug: "first",
								name: "First Lead",
								image: "https://example.com/first.jpg",
								subTitle: "First bio",
							},
							{ slug: "second", name: "Second Lead", image: null, subTitle: null },
						],
					},
				],
			},
		});
	});

	it.each([
		{ label: "no leaders", leaders: [], names: [] },
		{ label: "one lead", leaders: [lead("Pastor One", "one")], names: ["One"] },
		{
			label: "multiple leads without a group",
			leaders: [lead("Pastor One", "one", null), lead("Pastor Two", "two", null)],
			names: ["One", "Two"],
		},
		{
			label: "missing group and slug",
			leaders: [lead("Rev. Legacy", null, null), lead("Other", "other", "Ministers")],
			names: ["Legacy"],
		},
		{
			label: "unnamed leads",
			leaders: [
				lead(null, "null"),
				lead("", "empty"),
				lead("   ", "blank"),
				lead("Pastor Named", "named"),
			],
			names: ["Named"],
		},
	])("handles $label", async ({ leaders, names }) => {
		const result = await execute({
			schema,
			document: parse(
				"query { campusesV2 { ... on CampusesSuccess { campuses { campusLeads: leadPastor { name } } } } }",
			),
			contextValue: contextWith(Effect.succeed([{ ...campus, leaders }])),
		});
		expect(result.errors).toBeUndefined();
		expect(result.data).toEqual({
			campusesV2: { campuses: [{ campusLeads: names.map((name) => ({ name })) }] },
		});
	});
});

const HOUSE_OF_STARS_CARDS = ["Website", "Cashapp", "Givelify", "Zelle"];
const GIVING_QUERY = parse(
	"query { campusesV2 { ... on CampusesSuccess { campuses { slug giving givingPlatforms { title } } } } }",
);

const readGiving = async (campuses: Effect.Effect<readonly CmsCampus[], CmsContentError>) => {
	const result = await execute({
		schema,
		document: GIVING_QUERY,
		contextValue: contextWith(campuses),
	});
	expect(result.errors).toBeUndefined();
	return result.data;
};

/** campusesV2's answer to GIVING_QUERY for one campus, with its cards' titles. */
const givingAnswer = (slug: string, giving: string | null, cards: readonly string[] | null) => ({
	campusesV2: {
		campuses: [
			{ slug, giving, givingPlatforms: cards === null ? null : cards.map((title) => ({ title })) },
		],
	},
});

// House of Stars' cards are hardcoded; its CMS giving only switches them on, as on main, where
// any non-empty Strapi 4 `Giving` text did and `Campus.giving` was that text.
describe("campusesV2 giving", () => {
	const houseOfStars: CmsCampus = { ...campus, slug: "house-of-stars", name: "House of Stars" };

	it("shows House of Stars' cards and its first Strapi 5 link when it lists neither Cash App nor Zelle", async () => {
		const giving: CmsCampus["giving"] = [
			{ platform: "Givelify", value: "https://www.givelify.com/givenow/example" },
			{ platform: "Website", value: "https://hccnj.org/giving" },
		];

		expect(await readGiving(Effect.succeed([{ ...houseOfStars, giving }]))).toEqual(
			givingAnswer(
				"house-of-stars",
				"https://www.givelify.com/givenow/example",
				HOUSE_OF_STARS_CARDS,
			),
		);
	});

	it("shows no House of Stars giving when the CMS lists none", async () => {
		expect(await readGiving(Effect.succeed([houseOfStars]))).toEqual(
			givingAnswer("house-of-stars", null, null),
		);
	});

	it("shows a campus that only lists Givelify", async () => {
		const giving: CmsCampus["giving"] = [
			{ platform: "Givelify", value: "https://www.givelify.com/givenow/example" },
		];

		expect(await readGiving(Effect.succeed([{ ...campus, giving }]))).toEqual(
			givingAnswer("new-breed", "https://www.givelify.com/givenow/example", ["Givelify"]),
		);
	});

	it("keeps every website alongside legacy giving without changing the legacy text", async () => {
		const giving: CmsCampus["giving"] = [
			{ platform: "Zelle", value: "campus@example.org" },
			{ platform: "Website", value: "https://giving.example.org/tithe" },
			{ platform: "Website", value: "https://giving.example.org/donate" },
		];

		expect(await readGiving(Effect.succeed([{ ...campus, giving }]))).toEqual(
			givingAnswer("new-breed", "Zelle - campus@example.org", ["Zelle", "Website", "Website"]),
		);
	});

	it("keeps a giving address entered as a Website even without Cash App or Zelle", async () => {
		const giving: CmsCampus["giving"] = [{ platform: "Website", value: "campus@example.org" }];

		expect(await readGiving(Effect.succeed([{ ...campus, giving }]))).toEqual(
			givingAnswer("new-breed", "campus@example.org", ["Website"]),
		);
	});

	it("keeps absent giving null for other campuses", async () => {
		expect(await readGiving(Effect.succeed([campus]))).toEqual(
			givingAnswer("new-breed", null, null),
		);
	});
});
