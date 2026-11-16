import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { CmsContentV5Live, makeCmsContentV5 } from "@/effect/services/cms/content/v5Layer";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { makeMemoryRedis } from "@/graphql/__tests__/utils/memoryRedis";
import { describe, expect, it } from "bun:test";
import { ConfigProvider, Effect, Layer } from "effect";

import type { StrapiV2FetchFn } from "@hccnj/strapi-v2";

const campus = {
	slug: "new-breed",
	CampusName: "New Breed",
	Phone: null,
	Address: null,
	CityState: null,
	FacebookChannelLink: null,
	InstagramChannelLink: null,
	LiveStreamChannelLink: null,
	body: null,
	Header: null,
	Stream: null,
	GivingPlatforms: null,
	leaderships: [],
};

/** Answers each operation with `{"data": <its JSON>}` and records the operations requested. */
const fakeStrapi = (dataJsonByOperation: Readonly<Record<string, string>>) => {
	const operations: string[] = [];
	const fetch: StrapiV2FetchFn = (_url, _init, operation) => {
		operations.push(operation);
		return Effect.succeed(new Response(`{"data":${dataJsonByOperation[operation] ?? "null"}}`));
	};
	return { fetch, operations };
};

const withV5 = <A, E>(
	fetch: StrapiV2FetchFn,
	use: (cms: CmsContent["Service"]) => Effect.Effect<A, E>,
	{ redis = makeMemoryRedis(), logs = captureLogs() } = {},
) => {
	const config = { endpoint: "https://cms.example.test/graphql", token: "t" };
	const layer = Layer.effect(CmsContent, makeCmsContentV5(config, fetch)).pipe(
		Layer.provide(redis.layer),
		Layer.merge(logs.layer),
	);
	const program = Effect.gen(function* () {
		const cms = yield* CmsContent;
		return yield* use(cms);
	});
	return Effect.runPromise(program.pipe(Effect.provide(layer)));
};

describe("makeCmsContentV5", () => {
	it("caches campuses until the area is invalidated", async () => {
		const strapi = fakeStrapi({ StrapiV2Campuses: JSON.stringify({ campuses: [campus] }) });

		const names = await withV5(strapi.fetch, (cms) =>
			Effect.gen(function* () {
				const first = yield* cms.campuses;
				yield* cms.campuses;
				yield* cms.invalidate("campuses");
				yield* cms.campuses;
				return first.map((record) => record.name);
			}),
		);

		expect(names).toEqual(["New Breed"]);
		expect(strapi.operations).toEqual(["StrapiV2Campuses", "StrapiV2Campuses"]);
	});

	// Review Focus: Redis down on Railway must still serve CMS data.
	it("serves campuses while Redis is down", async () => {
		const strapi = fakeStrapi({ StrapiV2Campuses: JSON.stringify({ campuses: [campus] }) });

		const names = await withV5(
			strapi.fetch,
			(cms) =>
				Effect.all([cms.campuses, cms.campuses]).pipe(
					Effect.map((reads) => reads.map((records) => records.map((record) => record.name))),
				),
			{ redis: makeMemoryRedis(true) },
		);

		expect(names).toEqual([["New Breed"], ["New Breed"]]);
		expect(strapi.operations).toEqual(["StrapiV2Campuses"]);
	});

	it("caches events and sermons per query", async () => {
		const strapi = fakeStrapi({
			StrapiV2Events: JSON.stringify({ events: [] }),
			StrapiV2Sermons: JSON.stringify({ sermons: [], sermonPage: null }),
		});

		await withV5(strapi.fetch, (cms) =>
			Effect.all([
				cms.events({ campusSlug: "new-breed" }),
				cms.events({ campusSlug: "new-breed" }),
				cms.events({ campusSlug: "new-breed", reoccurring: "Weekly" }),
				cms.events({ campusSlug: "light-house" }),
				cms.sermons({ kind: "page", pageSize: 4 }),
				cms.sermons({ kind: "page", pageSize: 4 }),
				cms.sermons({ kind: "page", pageSize: 4, after: { date: "2026-09-01", slug: "a" } }),
				cms.sermons({ kind: "page", pageSize: 4, after: { date: "2026-09-01", slug: "b" } }),
				cms.sermons({ kind: "slugs", slugs: ["a"] }),
			]),
		);

		expect(strapi.operations).toEqual([
			"StrapiV2Events",
			"StrapiV2Events",
			"StrapiV2Events",
			"StrapiV2Sermons",
			"StrapiV2Sermons",
			"StrapiV2Sermons",
			"StrapiV2Sermons",
		]);
	});

	// Cursors come from clients: an empty one must not share the first page's cache entry.
	it("keys sermon pages by whether a cursor was given", async () => {
		const strapi = fakeStrapi({
			StrapiV2Sermons: JSON.stringify({ sermons: [], sermonPage: null }),
		});

		await withV5(strapi.fetch, (cms) =>
			Effect.all([
				cms.sermons({ kind: "page", pageSize: 4 }),
				cms.sermons({ kind: "page", pageSize: 4, after: { date: "", slug: "" } }),
				cms.sermons({ kind: "page", pageSize: 4, before: { date: "", slug: "" } }),
			]),
		);

		expect(strapi.operations).toEqual(["StrapiV2Sermons", "StrapiV2Sermons", "StrapiV2Sermons"]);
	});

	it("never caches stream access", async () => {
		const strapi = fakeStrapi({ StrapiV2CampusStream: JSON.stringify({ campuses: [] }) });

		await withV5(strapi.fetch, (cms) =>
			Effect.all([cms.streamAcl("light-house"), cms.streamAcl("light-house")]),
		);

		expect(strapi.operations).toEqual(["StrapiV2CampusStream", "StrapiV2CampusStream"]);
	});

	it("never caches featured cards or core sections", async () => {
		const strapi = fakeStrapi({
			StrapiV2HomeFeaturedCards: JSON.stringify({ home: null }),
			StrapiV2CampusFeaturedCards: JSON.stringify({ campuses: [] }),
			StrapiV2CoreSections: JSON.stringify({ appConfig: null }),
		});

		await withV5(strapi.fetch, (cms) =>
			Effect.all([
				cms.homeFeaturedCards,
				cms.homeFeaturedCards,
				cms.campusFeaturedCards("new-breed"),
				cms.campusFeaturedCards("new-breed"),
				cms.coreSections,
				cms.coreSections,
			]),
		);

		expect(strapi.operations).toEqual([
			"StrapiV2HomeFeaturedCards",
			"StrapiV2HomeFeaturedCards",
			"StrapiV2CampusFeaturedCards",
			"StrapiV2CampusFeaturedCards",
			"StrapiV2CoreSections",
			"StrapiV2CoreSections",
		]);
	});

	it("reports undecodable data as Malformed", async () => {
		const strapi = fakeStrapi({
			StrapiV2Campuses: JSON.stringify({
				campuses: [{ ...campus, body: { type: "doc", content: [{ type: "mysteryWidget" }] } }],
			}),
		});

		const error = await withV5(strapi.fetch, (cms) => Effect.flip(cms.campuses));

		expect(error.reason).toBe("Malformed");
		expect(error.operation).toBe("campuses");
	});

	it("logs a failed read once, with the failing Schema path", async () => {
		const strapi = fakeStrapi({
			StrapiV2Campuses: JSON.stringify({
				campuses: [{ ...campus, GivingPlatforms: [{ Platform: "Venmo", link: null }] }],
			}),
		});
		const logs = captureLogs();

		const error = await withV5(strapi.fetch, (cms) => Effect.flip(cms.campuses), { logs });

		expect(error.reason).toBe("Malformed");
		const annotations = {
			operation: "campuses",
			reason: "Decode",
			detail:
				'Expected "Zelle" | "Cashapp" | "Givelify" | "Website" | "Other"\n  at ["campuses"][0]["GivingPlatforms"][0]["Platform"]',
		};
		expect(logs.lines).toEqual([`Error Strapi 5 read failed ${JSON.stringify(annotations)}`]);
	});
});

const V5_TOKEN = "cms-v5-test-token";
const V5_ENDPOINT = "https://cms.example.test/graphql";

/** CmsContentV5Live over memory Redis and `env` as its only config. */
const buildV5Live = (env: Readonly<Record<string, string>>) => {
	const logs = captureLogs();
	const deps = Layer.mergeAll(
		makeMemoryRedis().layer,
		ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...env } })),
		logs.layer,
	);
	const layer = CmsContentV5Live.pipe(Layer.provide(deps));
	const run = <A, E>(program: Effect.Effect<A, E, CmsContent>) =>
		Effect.runPromise(program.pipe(Effect.provide(layer)));
	const startupError = () => Effect.runPromise(Layer.build(layer).pipe(Effect.scoped, Effect.flip));
	return { run, startupError, logs: logs.lines };
};

describe("CmsContentV5Live", () => {
	it("builds from CMS_V5_ENDPOINT and CMS_V5_TOKEN without logging the token", async () => {
		const { run, logs } = buildV5Live({ CMS_V5_ENDPOINT: V5_ENDPOINT, CMS_V5_TOKEN: V5_TOKEN });

		await run(CmsContent.use((cms) => cms.invalidate("campuses")));
		expect(logs.join("\n")).not.toContain(V5_TOKEN);
	});

	it("fails at startup without its endpoint", async () => {
		const error = await buildV5Live({ CMS_V5_TOKEN: V5_TOKEN }).startupError();
		expect(error._tag).toBe("ConfigError");
		expect(error.message).toContain("CMS_V5_ENDPOINT");
	});

	it("fails at startup without its token", async () => {
		const error = await buildV5Live({ CMS_V5_ENDPOINT: V5_ENDPOINT }).startupError();
		expect(error._tag).toBe("ConfigError");
		expect(error.message).toContain("CMS_V5_TOKEN");
	});
});
