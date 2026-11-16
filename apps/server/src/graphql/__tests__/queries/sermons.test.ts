import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { execute, parse } from "graphql";

import type { CmsSermon, CmsSermonsQuery } from "@hccnj/strapi-v2";

// Module mocks must be before any imports that use them. They only prevent real SDK
// initialization during schema import — the resolver reads sermons through CmsContent,
// faked per test below.
void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	db: { collection: mock() },
	secondaryDb: {},
	dbFieldValue: {},
	fieldPath: {},
	FBPaths: {},
	getStorageBucket: mock(),
	AppCollections: { users: "app-users", castrStreams: "castr-streams" },
	auth: { getUserByEmail: mock() },
}));

void mock.module("@/redis", () => ({
	redis: {
		get: mock(() => Promise.resolve(null)),
		set: mock(),
		mget: mock(),
		expire: mock(),
	},
}));

void mock.module("@/effect/Runtime", () => ({
	AppLayer: Layer.empty,
	managedRuntime: {
		runPromise: mock(() => Promise.resolve({ message: "Success" })),
	},
}));

const { schema } = await import("@/graphql/schema");
const { CmsContent } = await import("@/effect/services/cms/content/CmsContent");
const { authorized } = await import("../utils/test-context");

const sermon = (slug: string, date: string): CmsSermon => ({
	slug,
	title: slug,
	date,
	thumbnail: null,
	speaker: null,
	youtubeLink: `https://youtu.be/${slug}`,
	pageName: slug,
});

const position = (item: CmsSermon) => ({ date: item.date ?? "", slug: item.slug });

/** Whether `item` comes later than `cursor` in newest-first (date, slug) order. */
const isAfter = (item: CmsSermon, cursor: { date: string; slug: string }) => {
	const { date, slug } = position(item);
	return date < cursor.date || (date === cursor.date && slug < cursor.slug);
};

/** Serves pages the way both Strapi layers do: newest first, strictly after the cursor. */
const fakeCms = (sermons: readonly CmsSermon[]) =>
	Layer.succeed(CmsContent, {
		sermons: (query: CmsSermonsQuery) =>
			Effect.sync(() => {
				if (query.kind !== "page") {
					throw new Error("only pages are served");
				}
				const { after } = query;
				const items = sermons
					.toSorted((left, right) => (isAfter(left, position(right)) ? 1 : -1))
					.filter((item) => after === undefined || isAfter(item, after))
					.slice(0, query.pageSize);
				return { items, featuredImg: null, body: null };
			}),
	} as never);

const SERMONS_PAGE = parse(`
	query SermonsPage($first: Int, $after: String) {
		sermons(first: $first, after: $after) {
			edges { node { slug } }
			pageInfo { hasNextPage endCursor }
		}
	}
`);

type SermonsPage = {
	sermons: {
		edges: { node: { slug: string } }[];
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
};

const requestPage = async (sermons: readonly CmsSermon[], first: number, after: string | null) => {
	const layer = fakeCms(sermons);
	const context = authorized({
		effectRunPromise: <A, E, R>(program: Effect.Effect<A, E, R>) =>
			Effect.runPromise(program.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>),
	});
	const result = await execute({
		schema,
		document: SERMONS_PAGE,
		variableValues: { first, after },
		contextValue: context,
	});
	expect(result.errors).toBeUndefined();
	return (result.data as SermonsPage).sermons;
};

/** The slugs of each page the app would load, scrolling until `hasNextPage` is false. */
const scrollToTheEnd = async (sermons: readonly CmsSermon[], first: number) => {
	const pages: string[][] = [];
	let after: string | null = null;
	for (let page = 0; page < 10; page++) {
		const { edges, pageInfo } = await requestPage(sermons, first, after);
		pages.push(edges.map((edge) => edge.node.slug));
		if (!pageInfo.hasNextPage) {
			return pages;
		}
		after = pageInfo.endCursor;
	}
	throw new Error("pagination never reached the end");
};

const unservable = (slug: string, date: string): CmsSermon => ({
	...sermon(slug, date),
	youtubeLink: null,
});

describe("Query.sermons pagination", () => {
	// A page boundary inside a same-day group used to drop the rest of that day.
	it("serves every sermon once when several share a date", async () => {
		const sermons = [
			sermon("sample-e", "2026-03-01"),
			sermon("sample-d", "2026-02-01"),
			sermon("sample-c", "2026-02-01"),
			sermon("sample-b", "2026-02-01"),
			sermon("sample-a", "2026-01-01"),
		];

		expect(await scrollToTheEnd(sermons, 2)).toEqual([
			["sample-e", "sample-d"],
			["sample-c", "sample-b"],
			["sample-a"],
		]);
	});

	// Sermons missing a required field are dropped. Counting the page after dropping them ended
	// pagination early. An empty page with hasNextPage stalls the app's list, which only asks
	// for more when rows were added, so the page skips past dropped sermons to fill itself.
	it("fills each page past sermons it cannot serve", async () => {
		const sermons = [
			sermon("sample-g", "2026-07-01"),
			sermon("sample-f", "2026-06-01"),
			unservable("sample-e", "2026-05-01"),
			unservable("sample-d", "2026-04-01"),
			sermon("sample-c", "2026-03-01"),
			sermon("sample-b", "2026-02-01"),
		];

		expect(await scrollToTheEnd(sermons, 2)).toEqual([
			["sample-g", "sample-f"],
			["sample-c", "sample-b"],
		]);
	});

	// Home asks for `sermons(first: 3)` without paging, so dropped sermons must not crowd out
	// servable ones on the first page.
	it("fills the first page past sermons it cannot serve", async () => {
		const sermons = [
			unservable("sample-d", "2026-04-01"),
			unservable("sample-c", "2026-03-01"),
			unservable("sample-b", "2026-02-01"),
			sermon("sample-a", "2026-01-01"),
		];

		expect(await scrollToTheEnd(sermons, 3)).toEqual([["sample-a"]]);
	});

	// A sermon unpublished between two page loads can leave nothing after the cursor.
	it("answers an empty last page instead of an error", async () => {
		const sermons = [
			sermon("sample-c", "2026-03-01"),
			sermon("sample-b", "2026-02-01"),
			sermon("sample-a", "2026-01-01"),
		];
		const firstPage = await requestPage(sermons, 2, null);
		expect(firstPage.pageInfo.hasNextPage).toBe(true);

		const lastPage = await requestPage(sermons.slice(0, 2), 2, firstPage.pageInfo.endCursor);

		expect(lastPage.edges).toEqual([]);
		expect(lastPage.pageInfo.hasNextPage).toBe(false);
	});
});
