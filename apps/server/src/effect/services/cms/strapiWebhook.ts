import { CmsContent, type CmsCacheArea } from "@/effect/services/cms/content/CmsContent";
import { CMSService, logCacheWarning } from "@/effect/services/CMSService";
import { responseCache } from "@/graphql/responseCache";
import { CAMPUS_SLUGS, CampusSlugSchema, type CampusSlug } from "@/utils/campuses";
import { Effect, Schema } from "effect";
import { createHash, timingSafeEqual } from "node:crypto";

/** The request header that carries CMS_WEBHOOK_SECRET on a Strapi 5 change notice. */
export const CMS_WEBHOOK_SECRET_HEADER = "x-cms-webhook-secret";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Constant-time check of the presented header value (the raw secret, no "Bearer " prefix).
 * Strapi 5 notices are not signed, so the shared secret is the only proof. Empty never matches.
 */
export const secretMatches = (presented: string | undefined, secret: string): boolean =>
	presented !== undefined && presented !== "" && timingSafeEqual(digest(presented), digest(secret));

const StrapiWebhookEntrySchema = Schema.Struct({
	slug: Schema.optional(Schema.NullOr(Schema.String)),
});

/**
 * A Strapi 5 change notice, as the CMS's event-hub subscriber sends it through the
 * cmsWebhookUpdate mutation. The entry is only a signal: published content is always re-read.
 */
const StrapiWebhookPayloadSchema = Schema.Struct({
	event: Schema.String,
	uid: Schema.optional(Schema.NullOr(Schema.String)),
	model: Schema.optional(Schema.NullOr(Schema.String)),
	entry: Schema.optional(Schema.NullOr(StrapiWebhookEntrySchema)),
});
export type StrapiWebhookPayload = typeof StrapiWebhookPayloadSchema.Type;

export type StrapiWebhookAction =
	| { readonly kind: "ignored"; readonly reason: string }
	| { readonly kind: "coreSettings" }
	| { readonly kind: "homeFeatured" }
	| { readonly kind: "campusFeatured"; readonly slugs: readonly CampusSlug[] }
	| { readonly kind: "clear"; readonly area: CmsCacheArea };

export type StrapiWebhookWork = Exclude<StrapiWebhookAction, { readonly kind: "ignored" }>;

// Draft saves send entry.update with the draft as payload; only these events change published content.
const PUBLISHED_CONTENT_EVENTS = new Set(["entry.publish", "entry.unpublish", "entry.delete"]);

const CLEAR_AREAS = new Map<string, CmsCacheArea>([
	["api::leader-ship.leader-ship", "campuses"],
	["api::event.event", "events"],
	["api::sermon.sermon", "sermons"],
	["api::sermon-page.sermon-page", "sermons"],
	["api::tog.tog", "thoughtOfGod"],
	["api::check-in-permission.check-in-permission", "checkInPermissions"],
	["api::kids-checkin.kids-checkin", "checkInPermissions"],
	["api::department.department", "departments"],
	["api::ministry.ministry", "ministries"],
]);

// Unpublish and delete notices can arrive without the entry's slug.
const campusSlugsFor = (slug: string | null | undefined): readonly CampusSlug[] => {
	const trimmed = slug?.trim();
	if (!trimmed) {
		return CAMPUS_SLUGS;
	}
	return Schema.is(CampusSlugSchema)(trimmed) ? [trimmed] : [];
};

export const planStrapiWebhook = (payload: StrapiWebhookPayload): StrapiWebhookAction => {
	if (!PUBLISHED_CONTENT_EVENTS.has(payload.event)) {
		return { kind: "ignored", reason: `event ${payload.event}` };
	}
	switch (payload.uid) {
		case "api::app-config.app-config": {
			return { kind: "coreSettings" };
		}
		case "api::home.home": {
			return { kind: "homeFeatured" };
		}
		case "api::campus.campus": {
			return { kind: "campusFeatured", slugs: campusSlugsFor(payload.entry?.slug) };
		}
		default: {
			const area = payload.uid ? CLEAR_AREAS.get(payload.uid) : undefined;
			return area === undefined
				? { kind: "ignored", reason: `content type ${payload.uid ?? "unknown"}` }
				: { kind: "clear", area };
		}
	}
};

/** The name the mutation's response and its log line give the work. */
export const strapiWebhookWorkName = (work: StrapiWebhookWork): string =>
	work.kind === "clear" ? `clear:${work.area}` : work.kind;

const FEATURED_EVENT_TYPES = [
	"FeaturedEventsSuccess",
	"FeaturedEventsFetchError",
	"FeaturedEventsNotFoundError",
];

// A cached upcomingEventsByMonth answer with no months holds no Event, only its success type.
const EVENT_TYPES = ["Event", "UpcomingEventsByMonthSuccess"];

const AREA_RESPONSE_TYPES = new Map<CmsCacheArea, readonly string[]>([
	["campuses", ["Campus", "Campuses"]],
	["events", EVENT_TYPES],
	["sermons", ["Sermon"]],
	["thoughtOfGod", ["ThoughtOfGodPage"]],
]);

export const responseTypesFor = (work: StrapiWebhookWork): readonly string[] => {
	switch (work.kind) {
		case "coreSettings": {
			return ["Core"];
		}
		case "homeFeatured": {
			return ["Home", ...FEATURED_EVENT_TYPES];
		}
		case "campusFeatured": {
			return ["Campus", "Campuses", ...FEATURED_EVENT_TYPES, ...EVENT_TYPES];
		}
		case "clear": {
			return AREA_RESPONSE_TYPES.get(work.area) ?? [];
		}
	}
};

export const runStrapiWebhookAction = Effect.fn("StrapiWebhook.run")(function* (
	work: StrapiWebhookWork,
) {
	const cms = yield* CMSService;
	const content = yield* CmsContent;

	switch (work.kind) {
		case "coreSettings": {
			yield* cms.refreshCoreSettings;
			break;
		}
		case "homeFeatured": {
			// Also runs the upcoming-events refresh, which keeps stored rows on Strapi 5.
			yield* cms.refreshHomeData;
			break;
		}
		case "campusFeatured": {
			// A campus outside CAMPUS_SLUGS has no featured snapshot; only the campus list changed.
			yield* work.slugs.length === 0
				? cms.clearCampusesCache
				: Effect.forEach(work.slugs, (slug) => cms.refreshCampusFeaturedEvents(slug), {
						discard: true,
					});
			// Events can be linked from the campus page, which changes that campus's events. Like the
			// campuses cache clear after a featured refresh, a failure only warns: the refresh worked,
			// and cached events expire on their own.
			yield* content
				.invalidate("events")
				.pipe(
					Effect.catchTag(
						"CmsContentError",
						logCacheWarning("Failed to clear events cache", "runStrapiWebhookAction.clearEvents"),
					),
				);
			break;
		}
		case "clear": {
			// Clearing sermons also purges Stellate's cached sermon operations.
			yield* work.area === "sermons" ? cms.clearSermonsCache : content.invalidate(work.area);
			break;
		}
	}

	const name = strapiWebhookWorkName(work);
	const typenames = responseTypesFor(work);
	if (typenames.length > 0) {
		yield* Effect.tryPromise(async () => {
			await responseCache.invalidate(typenames.map((typename) => ({ typename })));
		}).pipe(
			Effect.catch((error) =>
				// tryPromise wraps what the cache threw in an UnknownError; log the thrown reason.
				Effect.logWarning("Response cache invalidation failed after a CMS webhook").pipe(
					Effect.annotateLogs({ action: name, error: String(error.cause) }),
				),
			),
		);
	}

	return name;
});
