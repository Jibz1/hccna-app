import { CmsContent, CmsContentError } from "@/effect/services/cms/content/CmsContent";
import {
	planStrapiWebhook,
	responseTypesFor,
	runStrapiWebhookAction,
	secretMatches,
	type StrapiWebhookWork,
} from "@/effect/services/cms/strapiWebhook";
import { CMSFetchError } from "@/effect/services/CMSErrors";
import { CMSService } from "@/effect/services/CMSService";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { configureResponseCache } from "@/graphql/responseCache";
import { CAMPUS_SLUGS } from "@/utils/campuses";
import { createInMemoryCache } from "@graphql-yoga/plugin-response-cache";
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

const publish = (uid: string, slug?: string | null) => ({
	event: "entry.publish",
	uid,
	entry: slug === undefined ? undefined : { slug },
});

// A fresh cache per test, like the module default, so no test depends on what another suite left configured.
beforeEach(() => {
	configureResponseCache(createInMemoryCache({ max: 500 }));
});

afterAll(() => {
	configureResponseCache(createInMemoryCache({ max: 500 }));
});

/** Installs a fresh cache that records the typenames it is asked to drop. */
const recordInvalidations = () => {
	const typenames: string[] = [];
	const cache = createInMemoryCache({ max: 500 });
	configureResponseCache({
		...cache,
		invalidate: (entities) => {
			for (const { typename } of entities) {
				typenames.push(typename);
			}
			return cache.invalidate(entities);
		},
	});
	return typenames;
};

describe("secretMatches", () => {
	it("compares the presented header value with the secret exactly", () => {
		expect(secretMatches("s3cret", "s3cret")).toBe(true);
		expect(secretMatches("s3cret2", "s3cret")).toBe(false);
		expect(secretMatches("s3cre", "s3cret")).toBe(false);
		expect(secretMatches("S3CRET", "s3cret")).toBe(false);
		// The header carries the raw secret; an Authorization-style prefix is not stripped.
		expect(secretMatches("Bearer s3cret", "s3cret")).toBe(false);
	});

	it("never matches an empty or missing value", () => {
		expect(secretMatches("", "s3cret")).toBe(false);
		expect(secretMatches(undefined, "s3cret")).toBe(false);
		expect(secretMatches("", "")).toBe(false);
	});
});

describe("planStrapiWebhook", () => {
	it("ignores draft saves and other non-publishing events", () => {
		for (const event of [
			"entry.create",
			"entry.update",
			"entry.draft-discard",
			"media.create",
			"trigger-test",
		]) {
			expect(planStrapiWebhook({ event, uid: "api::home.home" }).kind).toBe("ignored");
		}
	});

	it("maps each content type to its action", () => {
		expect(planStrapiWebhook(publish("api::app-config.app-config"))).toEqual({
			kind: "coreSettings",
		});
		expect(planStrapiWebhook({ event: "entry.unpublish", uid: "api::home.home" })).toEqual({
			kind: "homeFeatured",
		});
		expect(planStrapiWebhook(publish("api::leader-ship.leader-ship"))).toEqual({
			kind: "clear",
			area: "campuses",
		});
		expect(planStrapiWebhook(publish("api::event.event"))).toEqual({
			kind: "clear",
			area: "events",
		});
		expect(planStrapiWebhook(publish("api::sermon.sermon"))).toEqual({
			kind: "clear",
			area: "sermons",
		});
		expect(planStrapiWebhook(publish("api::sermon-page.sermon-page"))).toEqual({
			kind: "clear",
			area: "sermons",
		});
		expect(planStrapiWebhook(publish("api::tog.tog"))).toEqual({
			kind: "clear",
			area: "thoughtOfGod",
		});
		expect(planStrapiWebhook(publish("api::check-in-permission.check-in-permission"))).toEqual({
			kind: "clear",
			area: "checkInPermissions",
		});
		expect(
			planStrapiWebhook({ event: "entry.delete", uid: "api::kids-checkin.kids-checkin" }),
		).toEqual({ kind: "clear", area: "checkInPermissions" });
		expect(planStrapiWebhook(publish("api::department.department"))).toEqual({
			kind: "clear",
			area: "departments",
		});
		expect(planStrapiWebhook(publish("api::ministry.ministry"))).toEqual({
			kind: "clear",
			area: "ministries",
		});
		expect(planStrapiWebhook(publish("api::stream.stream")).kind).toBe("ignored");
		expect(planStrapiWebhook({ event: "entry.publish" }).kind).toBe("ignored");
	});

	it("refreshes one app campus, all campuses when the slug is missing, none for other campuses", () => {
		expect(planStrapiWebhook(publish("api::campus.campus", "new-breed"))).toEqual({
			kind: "campusFeatured",
			slugs: ["new-breed"],
		});
		expect(planStrapiWebhook(publish("api::campus.campus", " light-house "))).toEqual({
			kind: "campusFeatured",
			slugs: ["light-house"],
		});
		expect(planStrapiWebhook(publish("api::campus.campus", null))).toEqual({
			kind: "campusFeatured",
			slugs: CAMPUS_SLUGS,
		});
		expect(planStrapiWebhook({ event: "entry.delete", uid: "api::campus.campus" })).toEqual({
			kind: "campusFeatured",
			slugs: CAMPUS_SLUGS,
		});
		expect(planStrapiWebhook(publish("api::campus.campus", "campus"))).toEqual({
			kind: "campusFeatured",
			slugs: [],
		});
	});
});

/** CMSService and CmsContent fakes that record each call, in order. */
const fakes = () => {
	const calls: string[] = [];
	const record = (call: string) =>
		Effect.sync(() => {
			calls.push(call);
		});
	const cms = {
		refreshCoreSettings: record("refreshCoreSettings"),
		refreshHomeData: record("refreshHomeData"),
		refreshCampusFeaturedEvents: mock((slug: string) =>
			record(`refreshCampusFeaturedEvents ${slug}`),
		),
		clearCampusesCache: record("clearCampusesCache"),
		clearSermonsCache: record("clearSermonsCache"),
	};
	const content = { invalidate: mock((area: string) => record(`invalidate ${area}`)) };
	const layer = Layer.mergeAll(
		Layer.succeed(CMSService, cms as never),
		Layer.succeed(CmsContent, content as never),
	);
	return { cms, content, calls, layer };
};

describe("runStrapiWebhookAction", () => {
	it("refreshes each requested campus", async () => {
		const { cms, layer } = fakes();
		const done = await Effect.runPromise(
			runStrapiWebhookAction({ kind: "campusFeatured", slugs: ["new-breed", "light-house"] }).pipe(
				Effect.provide(layer),
			),
		);
		expect(done).toBe("campusFeatured");
		expect(cms.refreshCampusFeaturedEvents.mock.calls.map(([slug]) => slug)).toEqual([
			"new-breed",
			"light-house",
		]);
	});

	const featuredEvents = [
		"FeaturedEventsSuccess",
		"FeaturedEventsFetchError",
		"FeaturedEventsNotFoundError",
	];
	const eventTypes = ["Event", "UpcomingEventsByMonthSuccess"];
	// The spec's dispatch table, plus events for campus work: each action's CMS work, its name,
	// then the response types it drops.
	const dispatch: {
		readonly label: string;
		readonly work: StrapiWebhookWork;
		readonly done: string;
		readonly calls: string[];
		readonly typenames: string[];
	}[] = [
		{
			label: "core settings",
			work: { kind: "coreSettings" },
			done: "coreSettings",
			calls: ["refreshCoreSettings"],
			typenames: ["Core"],
		},
		{
			label: "home",
			work: { kind: "homeFeatured" },
			done: "homeFeatured",
			calls: ["refreshHomeData"],
			typenames: ["Home", ...featuredEvents],
		},
		{
			label: "an app campus",
			work: { kind: "campusFeatured", slugs: ["new-breed"] },
			done: "campusFeatured",
			calls: ["refreshCampusFeaturedEvents new-breed", "invalidate events"],
			typenames: ["Campus", "Campuses", ...featuredEvents, ...eventTypes],
		},
		{
			label: "another campus",
			work: { kind: "campusFeatured", slugs: [] },
			done: "campusFeatured",
			calls: ["clearCampusesCache", "invalidate events"],
			typenames: ["Campus", "Campuses", ...featuredEvents, ...eventTypes],
		},
		{
			label: "campus list",
			work: { kind: "clear", area: "campuses" },
			done: "clear:campuses",
			calls: ["invalidate campuses"],
			typenames: ["Campus", "Campuses"],
		},
		{
			label: "events",
			work: { kind: "clear", area: "events" },
			done: "clear:events",
			calls: ["invalidate events"],
			typenames: eventTypes,
		},
		{
			label: "sermons",
			work: { kind: "clear", area: "sermons" },
			done: "clear:sermons",
			calls: ["clearSermonsCache"],
			typenames: ["Sermon"],
		},
		{
			label: "Thought of God",
			work: { kind: "clear", area: "thoughtOfGod" },
			done: "clear:thoughtOfGod",
			calls: ["invalidate thoughtOfGod"],
			typenames: ["ThoughtOfGodPage"],
		},
		{
			label: "check-in permissions",
			work: { kind: "clear", area: "checkInPermissions" },
			done: "clear:checkInPermissions",
			calls: ["invalidate checkInPermissions"],
			typenames: [],
		},
		{
			label: "departments",
			work: { kind: "clear", area: "departments" },
			done: "clear:departments",
			calls: ["invalidate departments"],
			typenames: [],
		},
		{
			label: "ministries",
			work: { kind: "clear", area: "ministries" },
			done: "clear:ministries",
			calls: ["invalidate ministries"],
			typenames: [],
		},
	];

	it.each(dispatch)("$label: does the CMS work, then drops its response types", async (row) => {
		const { calls, layer } = fakes();
		const invalidated = recordInvalidations();
		const done = await Effect.runPromise(
			runStrapiWebhookAction(row.work).pipe(Effect.provide(layer)),
		);
		expect({ done, calls, typenames: invalidated }).toEqual({
			done: row.done,
			calls: row.calls,
			typenames: row.typenames,
		});
		expect(responseTypesFor(row.work)).toEqual(row.typenames);
	});

	it("keeps its result when the response cache cannot be invalidated", async () => {
		configureResponseCache({
			...createInMemoryCache({ max: 500 }),
			invalidate: () => Promise.reject(new Error("cache unavailable")),
		});
		const { layer } = fakes();
		const logs = captureLogs();
		const withLogs = Layer.merge(layer, logs.layer);
		const done = await Effect.runPromise(
			runStrapiWebhookAction({ kind: "clear", area: "events" }).pipe(Effect.provide(withLogs)),
		);
		expect(done).toBe("clear:events");
		expect(logs.lines).toEqual([
			'Warn Response cache invalidation failed after a CMS webhook {"action":"clear:events","error":"Error: cache unavailable"}',
		]);
	});

	it("keeps a campus refresh's result when the events cache cannot be cleared", async () => {
		const { cms, calls } = fakes();
		const invalidated = recordInvalidations();
		const logs = captureLogs();
		const redisDown = new CmsContentError({
			reason: "Unavailable",
			operation: "invalidate.events",
			detail: "Failed to clear the Strapi 5 cache",
			cause: new Error("Redis keys failed"),
		});
		const layer = Layer.mergeAll(
			Layer.succeed(CMSService, cms as never),
			Layer.succeed(CmsContent, { invalidate: () => Effect.fail(redisDown) } as never),
			logs.layer,
		);
		const done = await Effect.runPromise(
			runStrapiWebhookAction({ kind: "campusFeatured", slugs: ["new-breed"] }).pipe(
				Effect.provide(layer),
			),
		);
		expect(done).toBe("campusFeatured");
		expect(calls).toEqual(["refreshCampusFeaturedEvents new-breed"]);
		expect(invalidated).toEqual(["Campus", "Campuses", ...featuredEvents, ...eventTypes]);
		expect(logs.lines).toEqual([
			'Warn Failed to clear events cache {"operation":"runStrapiWebhookAction.clearEvents","cmsOperation":"invalidate.events","detail":"Failed to clear the Strapi 5 cache","cause":"Redis keys failed"}',
		]);
	});

	it("fails without touching the response cache when the CMS work fails", async () => {
		const invalidated = recordInvalidations();
		const strapiDown = new CMSFetchError({ detail: "Strapi down" });
		const layer = Layer.mergeAll(
			Layer.succeed(CMSService, { refreshCoreSettings: Effect.fail(strapiDown) } as never),
			Layer.succeed(CmsContent, { invalidate: () => Effect.void } as never),
		);
		const error = await Effect.runPromise(
			runStrapiWebhookAction({ kind: "coreSettings" }).pipe(Effect.flip, Effect.provide(layer)),
		);
		expect(error).toBe(strapiDown);
		expect(invalidated).toEqual([]);
	});
});
