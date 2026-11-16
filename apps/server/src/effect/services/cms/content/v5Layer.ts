import { CmsContent, CmsContentError } from "@/effect/services/cms/content/CmsContent";
import { makeRecordCache, recordCacheKey } from "@/effect/services/cms/content/recordCache";
import { serviceRequest } from "@/utils/serviceRequest";
import {
	CmsCampus,
	CmsCheckInPermission,
	CmsDepartment,
	CmsEvent,
	CmsMinistry,
	CmsSermonPage,
	CmsThoughtOfGod,
	createStrapiV2Client,
	type CmsSermonCursor,
	type StrapiV2ClientConfig,
	type StrapiV2Error,
	type StrapiV2FetchFn,
} from "@hccnj/strapi-v2";
import { Config, Effect, Layer, Redacted, Schema } from "effect";

const strapiV5Config = Config.all({
	endpoint: Config.String("CMS_V5_ENDPOINT"),
	token: Config.Redacted("CMS_V5_TOKEN"),
});

// What each cached member stores; a cached value is decoded with it again when read back.
const Campuses = Schema.Array(CmsCampus);
const Events = Schema.Array(CmsEvent);
const ThoughtOfGod = Schema.NullOr(CmsThoughtOfGod);
const CheckInPermissions = Schema.NullOr(Schema.Array(CmsCheckInPermission));
const Departments = Schema.Array(CmsDepartment);
const Ministries = Schema.Array(CmsMinistry);

// Through serviceRequest so Strapi 5 calls show up in the service metrics as service="strapi-v5".
const httpFetch: StrapiV2FetchFn = (url, init, operation) =>
	Effect.tryPromise(() =>
		serviceRequest({
			url,
			options: {
				method: init.method,
				headers: { ...init.headers },
				body: init.body,
				timeout: init.timeout,
			},
			service: "strapi-v5",
			action: operation,
		}),
	);

/**
 * A client read reported under its CmsContent member: Decode → Malformed, the rest → Unavailable.
 * Each failure is logged once, here: a Decode detail names the failing Schema path.
 */
const read = <A>(operation: string, effect: Effect.Effect<A, StrapiV2Error>) =>
	effect.pipe(
		Effect.tapError((error) =>
			Effect.logError("Strapi 5 read failed").pipe(
				Effect.annotateLogs({ operation, reason: error.reason, detail: error.detail }),
			),
		),
		Effect.mapError(
			(error) =>
				new CmsContentError({
					reason: error.reason === "Decode" ? "Malformed" : "Unavailable",
					operation,
					detail: error.message,
					cause: error,
				}),
		),
	);

// Cursors come from clients: JSON keeps an empty cursor apart from none, and its quoting
// keeps a "|" inside a value from passing for a key separator.
const cursorKeyPart = (cursor: CmsSermonCursor | undefined) =>
	cursor === undefined ? undefined : JSON.stringify([cursor.date, cursor.slug]);

/*
 * Strapi 5 → records. Cached (memory, then Redis): campuses, events, sermons, Thought of God,
 * check-in permissions, departments and ministries. Featured cards and core sections are not
 * cached (their snapshots live in Postgres); stream access is always read fresh because it
 * authorizes stream edits.
 */
export const makeCmsContentV5 = (config: StrapiV2ClientConfig, fetch: StrapiV2FetchFn) =>
	Effect.gen(function* () {
		const client = createStrapiV2Client(config, fetch);
		const cache = yield* makeRecordCache;

		return CmsContent.of({
			campuses: cache.cached(
				recordCacheKey("campuses"),
				Campuses,
				read("campuses", client.campuses),
			),
			events: (filter) =>
				cache.cached(
					recordCacheKey("events", [
						filter.campusSlug,
						filter.reoccurring,
						filter.slug,
						filter.upcomingFrom,
					]),
					Events,
					read("events", client.events(filter)),
				),
			sermons: (query) =>
				cache.cached(
					recordCacheKey(
						"sermons",
						query.kind === "slugs"
							? ["slugs", query.slugs.join(",")]
							: ["page", query.pageSize, cursorKeyPart(query.after), cursorKeyPart(query.before)],
					),
					CmsSermonPage,
					read("sermons", client.sermons(query)),
				),
			thoughtOfGod: cache.cached(
				recordCacheKey("thoughtOfGod"),
				ThoughtOfGod,
				read("thoughtOfGod", client.thoughtOfGod),
			),
			homeFeaturedCards: read("homeFeaturedCards", client.homeFeaturedCards),
			campusFeaturedCards: (slug) => read("campusFeaturedCards", client.campusFeaturedCards(slug)),
			coreSections: read("coreSections", client.coreSections),
			streamAcl: (slug) => read("streamAcl", client.streamAcl(slug)),
			checkInPermissions: cache.cached(
				recordCacheKey("checkInPermissions"),
				CheckInPermissions,
				read("checkInPermissions", client.checkInPermissions),
			),
			departments: cache.cached(
				recordCacheKey("departments"),
				Departments,
				read("departments", client.departments),
			),
			ministries: cache.cached(
				recordCacheKey("ministries"),
				Ministries,
				read("ministries", client.ministries),
			),
			invalidate: cache.clear,
		});
	});

export const CmsContentV5Live = Layer.effect(
	CmsContent,
	Effect.gen(function* () {
		const { endpoint, token } = yield* strapiV5Config;
		return yield* makeCmsContentV5({ endpoint, token: Redacted.value(token) }, httpFetch);
	}),
);
