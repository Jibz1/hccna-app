import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { CMS_WEBHOOK_SECRET_HEADER } from "@/effect/services/cms/strapiWebhook";
import { CMSFetchError } from "@/effect/services/CMSErrors";
import { CMSService } from "@/effect/services/CMSService";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { anonymous, authorized } from "@/graphql/__tests__/utils/test-context";
import { configureResponseCache } from "@/graphql/responseCache";
import { schema } from "@/graphql/schema";
import { CAMPUS_SLUGS } from "@/utils/campuses";
import { createInMemoryCache } from "@graphql-yoga/plugin-response-cache";
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { ConfigProvider, Effect, Layer } from "effect";
import { execute, GraphQLError, parse } from "graphql";

const MUTATION = `mutation CmsWebhookUpdate($input: StrapiWebHookUpdateInput!) {
	cmsWebhookUpdate(input: $input) { success message }
}`;

const SECRET = "cms-webhook-test-secret";
const CONFIGURED = { CMS_WEBHOOK_SECRET: SECRET };
const WITH_SECRET = { [CMS_WEBHOOK_SECRET_HEADER]: SECRET };

const FEATURED_EVENTS = [
	"FeaturedEventsSuccess",
	"FeaturedEventsFetchError",
	"FeaturedEventsNotFoundError",
];
// Strapi 5 event and campus work drop these: events are linked from the campus page.
const EVENTS = ["Event", "UpcomingEventsByMonthSuccess"];

interface NoticeFields {
	readonly event: string;
	readonly uid: string;
	readonly slug?: string;
	readonly cmsVersion?: "V4" | "V5";
}

/** The mutation input the CMS sends; `model` and `createdAt` are required but unused. */
const notice = (fields: NoticeFields) => ({
	createdAt: "2026-10-04T12:00:00.000Z",
	model: fields.uid.split(".").at(-1) ?? fields.uid,
	...fields,
});

interface CmsOverrides {
	readonly refreshCoreSettings?: Effect.Effect<void, CMSFetchError>;
	readonly refreshHomeData?: Effect.Effect<void, CMSFetchError>;
}

/**
 * Runs the mutation against CMSService and CmsContent fakes that record each call, a response
 * cache that records the typenames it drops, the given environment and captured logs.
 */
const harness = (env: Readonly<Record<string, string>> = {}, overrides: CmsOverrides = {}) => {
	const calls: string[] = [];
	const record = (call: string) =>
		Effect.sync(() => {
			calls.push(call);
		});
	const cms = {
		refreshCoreSettings: record("refreshCoreSettings"),
		refreshHomeData: record("refreshHomeData"),
		refreshCampusFeaturedEvents: (slug: string) => record(`refreshCampusFeaturedEvents ${slug}`),
		clearCampusesCache: record("clearCampusesCache"),
		clearSermonsCache: record("clearSermonsCache"),
		...overrides,
	};
	const content = { invalidate: (area: string) => record(`invalidate ${area}`) };
	const logs = captureLogs();
	const layer = Layer.mergeAll(
		Layer.succeed(CMSService, cms as never),
		Layer.succeed(CmsContent, content as never),
		ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...env } })),
		logs.layer,
	);

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

	const run = async (
		input: ReturnType<typeof notice>,
		headers: Readonly<Record<string, string>> = {},
		signal?: AbortSignal,
	) =>
		await execute({
			schema,
			document: parse(MUTATION),
			contextValue: {
				...authorized({
					effectRunPromise: <A, E, R>(program: Effect.Effect<A, E, R>) =>
						Effect.runPromise(program.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>, {
							signal,
						}),
				}),
				request: new Request("http://localhost/graphql", { method: "POST", headers }),
			},
			variableValues: { input },
		});

	return { run, calls, typenames, logs: logs.lines };
};

// A fresh cache, like the module default, so no other suite sees this file's recording cache.
beforeEach(() => {
	configureResponseCache(createInMemoryCache({ max: 500 }));
});

afterAll(() => {
	configureResponseCache(createInMemoryCache({ max: 500 }));
});

const strapi4IgnoredLog = (fields: NoticeFields) =>
	`Warn CMS webhook ignored: Strapi 4 notice ${JSON.stringify({
		event: fields.event,
		uid: fields.uid,
		action: "none",
		outcome: "ignored",
		cmsVersion: fields.cmsVersion ?? "V4",
	})}`;

interface Strapi5Work {
	readonly label: string;
	readonly fields: NoticeFields;
	readonly action: string;
	readonly calls: string[];
	readonly typenames: string[];
}

describe("cmsWebhookUpdate", () => {
	const publishHome: NoticeFields = {
		event: "entry.publish",
		uid: "api::home.home",
		cmsVersion: "V5",
	};
	const handledLog = (fields: NoticeFields, action: string) =>
		`Info Strapi 5 webhook handled ${JSON.stringify({
			event: fields.event,
			uid: fields.uid,
			action,
			outcome: "ok",
		})}`;

	it.each([
		{ label: "omitted", fields: { event: "entry.publish", uid: "api::home.home" } },
		{ label: "V4", fields: { event: "entry.publish", uid: "api::home.home", cmsVersion: "V4" } },
	] as const)("ignores a Strapi 4 notice (cmsVersion $label)", async ({ fields }) => {
		const { run, calls, typenames, logs } = harness(CONFIGURED);
		const result = await run(notice(fields), WITH_SECRET);
		expect(result.data?.cmsWebhookUpdate).toEqual({
			success: true,
			message: "Ignored: Strapi 4 notice",
		});
		expect({ calls, typenames, logs }).toEqual({
			calls: [],
			typenames: [],
			logs: [strapi4IgnoredLog(fields)],
		});
	});

	it.each([
		{ label: "unset", env: {} },
		{ label: "blank", env: { CMS_WEBHOOK_SECRET: "  " } },
	])("answers not configured when CMS_WEBHOOK_SECRET is $label", async ({ env }) => {
		const { run, calls, logs } = harness(env);
		const result = await run(notice(publishHome), WITH_SECRET);
		expect(result.data?.cmsWebhookUpdate).toEqual({
			success: false,
			message: "Strapi 5 notices are not configured",
		});
		expect(calls).toEqual([]);
		expect(logs).toEqual([
			'Error Strapi 5 webhook dropped: CMS_WEBHOOK_SECRET is not set {"event":"entry.publish","uid":"api::home.home","action":"none","outcome":"notConfigured"}',
		]);
	});

	it.each([
		{ label: "missing", headers: {} },
		{ label: "wrong", headers: { [CMS_WEBHOOK_SECRET_HEADER]: "not-the-secret" } },
		{ label: "prefixed", headers: { [CMS_WEBHOOK_SECRET_HEADER]: `Bearer ${SECRET}` } },
		{ label: "Authorization-only", headers: { authorization: `Bearer ${SECRET}` } },
	])("rejects a $label secret header like a failed auth scope", async ({ headers }) => {
		const scopeFailure = await execute({
			schema,
			document: parse(MUTATION),
			contextValue: anonymous(),
			variableValues: { input: notice(publishHome) },
		});
		const { run, calls, typenames, logs } = harness(CONFIGURED);
		const result = await run(notice(publishHome), headers);

		expect(result.data).toEqual({ cmsWebhookUpdate: null });
		expect(result.errors?.map((error) => error.message)).toEqual(
			scopeFailure.errors?.map((error) => error.message),
		);
		// An original GraphQL error, which the Sentry plugin skips like any auth failure.
		expect(result.errors?.[0]?.originalError).toBeInstanceOf(GraphQLError);
		expect({ calls, typenames, logs }).toEqual({
			calls: [],
			typenames: [],
			logs: [
				'Warn Strapi 5 webhook rejected: wrong or missing secret header {"event":"entry.publish","uid":"api::home.home","action":"none","outcome":"unauthorized"}',
			],
		});
	});

	// Fetch trims header values, so whitespace around either side must not fail the check.
	it.each([
		{ label: "the configured secret", secret: `  ${SECRET}\n`, header: SECRET },
		{ label: "the header", secret: SECRET, header: ` ${SECRET}\t` },
	])("accepts a secret with whitespace around $label", async ({ secret, header }) => {
		const { run, calls, logs } = harness({ CMS_WEBHOOK_SECRET: secret });
		const result = await run(notice(publishHome), { [CMS_WEBHOOK_SECRET_HEADER]: header });
		expect(result.errors).toBeUndefined();
		expect(result.data?.cmsWebhookUpdate).toEqual({ success: true, message: "homeFeatured" });
		expect(calls).toEqual(["refreshHomeData"]);
		expect(logs).toEqual([handledLog(publishHome, "homeFeatured")]);
	});

	it.each([
		{
			label: "a draft save",
			fields: { event: "entry.update", uid: "api::home.home" },
			reason: "event entry.update",
		},
		{
			label: "a new draft",
			fields: { event: "entry.create", uid: "api::home.home" },
			reason: "event entry.create",
		},
		{
			label: "a media upload",
			fields: { event: "media.create", uid: "plugin::upload.file" },
			reason: "event media.create",
		},
		{
			label: "a stream",
			fields: { event: "entry.publish", uid: "api::stream.stream" },
			reason: "content type api::stream.stream",
		},
		{
			label: "an unknown model",
			fields: { event: "entry.publish", uid: "api::unknown.unknown" },
			reason: "content type api::unknown.unknown",
		},
	])("ignores $label without running anything", async ({ fields, reason }) => {
		const { run, calls, typenames, logs } = harness(CONFIGURED);
		const result = await run(notice({ ...fields, cmsVersion: "V5" }), WITH_SECRET);
		expect(result.data?.cmsWebhookUpdate).toEqual({ success: true, message: `Ignored: ${reason}` });
		const annotations = { ...fields, action: "ignored", outcome: "ignored", reason };
		expect({ calls, typenames, logs }).toEqual({
			calls: [],
			typenames: [],
			logs: [`Info Strapi 5 webhook ignored ${JSON.stringify(annotations)}`],
		});
	});

	// strapiWebhook.test.ts covers the whole dispatch table; these pin the mutation's wiring.
	const strapi5Work: Strapi5Work[] = [
		{
			label: "core settings",
			fields: { event: "entry.publish", uid: "api::app-config.app-config" },
			action: "coreSettings",
			calls: ["refreshCoreSettings"],
			typenames: ["Core"],
		},
		{
			label: "home",
			fields: { event: "entry.publish", uid: "api::home.home" },
			action: "homeFeatured",
			calls: ["refreshHomeData"],
			typenames: ["Home", ...FEATURED_EVENTS],
		},
		{
			label: "an app campus",
			fields: { event: "entry.publish", uid: "api::campus.campus", slug: "new-breed" },
			action: "campusFeatured",
			calls: ["refreshCampusFeaturedEvents new-breed", "invalidate events"],
			typenames: ["Campus", "Campuses", ...FEATURED_EVENTS, ...EVENTS],
		},
		{
			label: "a campus whose slug the notice left out",
			fields: { event: "entry.unpublish", uid: "api::campus.campus" },
			action: "campusFeatured",
			calls: [
				...CAMPUS_SLUGS.map((slug) => `refreshCampusFeaturedEvents ${slug}`),
				"invalidate events",
			],
			typenames: ["Campus", "Campuses", ...FEATURED_EVENTS, ...EVENTS],
		},
		{
			label: "events",
			fields: { event: "entry.delete", uid: "api::event.event" },
			action: "clear:events",
			calls: ["invalidate events"],
			typenames: EVENTS,
		},
	];

	it.each(strapi5Work)("$label: runs the work and answers with its name", async (row) => {
		const { run, calls, typenames, logs } = harness(CONFIGURED);
		const result = await run(notice({ ...row.fields, cmsVersion: "V5" }), WITH_SECRET);
		expect(result.errors).toBeUndefined();
		expect(result.data?.cmsWebhookUpdate).toEqual({ success: true, message: row.action });
		expect({ calls, typenames, logs }).toEqual({
			calls: row.calls,
			typenames: row.typenames,
			logs: [handledLog(row.fields, row.action)],
		});
		expect(logs.join("\n")).not.toContain(SECRET);
	});

	it("answers { success: false } with the action's name and logs an error when the work fails", async () => {
		const { run, typenames, logs } = harness(CONFIGURED, {
			refreshCoreSettings: Effect.fail(new CMSFetchError({ detail: "Strapi down" })),
		});
		const result = await run(
			notice({ event: "entry.publish", uid: "api::app-config.app-config", cmsVersion: "V5" }),
			WITH_SECRET,
		);
		expect(result.errors).toBeUndefined();
		expect(result.data?.cmsWebhookUpdate).toEqual({ success: false, message: "coreSettings" });
		expect(typenames).toEqual([]);
		expect(logs).toEqual([
			'Error Strapi 5 webhook failed {"event":"entry.publish","uid":"api::app-config.app-config","action":"coreSettings","outcome":"failed","error":"CMS fetch: Strapi down"}',
		]);
		expect(logs.join("\n")).not.toContain(SECRET);
	});

	it("finishes a refresh the client hung up on, and logs its outcome", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let finished = false;
		const { run, typenames, logs } = harness(CONFIGURED, {
			refreshHomeData: Effect.gen(function* () {
				started.resolve();
				yield* Effect.promise(() => release.promise);
				finished = true;
			}),
		});
		const hangUp = new AbortController();
		const responded = run(notice(publishHome), WITH_SECRET, hangUp.signal);
		await started.promise;
		hangUp.abort();
		release.resolve();
		await responded;
		expect(finished).toBe(true);
		expect(typenames).toEqual(["Home", ...FEATURED_EVENTS]);
		expect(logs).toEqual([handledLog(publishHome, "homeFeatured")]);
	});
});
