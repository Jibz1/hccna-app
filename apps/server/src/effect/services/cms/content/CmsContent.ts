import { Context, Schema, type Effect } from "effect";

import type {
	CmsCampus,
	CmsCheckInPermission,
	CmsCoreSections,
	CmsDepartment,
	CmsEvent,
	CmsEventsFilter,
	CmsFeaturedCard,
	CmsMinistry,
	CmsSermonPage,
	CmsSermonsQuery,
	CmsStreamAcl,
	CmsThoughtOfGod,
} from "@hccnj/strapi-v2";

export class CmsContentError extends Schema.TaggedError<CmsContentError>()("CmsContentError", {
	reason: Schema.Literals(["Unavailable", "Malformed"]),
	operation: Schema.String,
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `CMS ${this.operation} ${this.reason.toLowerCase()}: ${this.detail}`;
	}
}

export type CmsCacheArea =
	| "campuses"
	| "events"
	| "sermons"
	| "thoughtOfGod"
	| "checkInPermissions"
	| "departments"
	| "ministries";

interface CmsContentContract {
	readonly campuses: Effect.Effect<readonly CmsCampus[], CmsContentError>;
	readonly events: (filter: CmsEventsFilter) => Effect.Effect<readonly CmsEvent[], CmsContentError>;
	readonly sermons: (query: CmsSermonsQuery) => Effect.Effect<CmsSermonPage, CmsContentError>;
	readonly thoughtOfGod: Effect.Effect<CmsThoughtOfGod | null, CmsContentError>;
	/** `null` when the home entry is missing. */
	readonly homeFeaturedCards: Effect.Effect<readonly CmsFeaturedCard[] | null, CmsContentError>;
	readonly campusFeaturedCards: (
		slug: string,
	) => Effect.Effect<readonly CmsFeaturedCard[], CmsContentError>;
	/** `null` when the core entry is missing. Absent keys mean "keep the stored value". */
	readonly coreSections: Effect.Effect<CmsCoreSections | null, CmsContentError>;
	/**
	 * Always read fresh: it authorizes stream edits. `null`, or a record with a falsy
	 * `streamId`, means no stream configured.
	 */
	readonly streamAcl: (slug: string) => Effect.Effect<CmsStreamAcl | null, CmsContentError>;
	/** `null` when the permission list is missing (invalid data). */
	readonly checkInPermissions: Effect.Effect<
		readonly CmsCheckInPermission[] | null,
		CmsContentError
	>;
	readonly departments: Effect.Effect<readonly CmsDepartment[], CmsContentError>;
	readonly ministries: Effect.Effect<readonly CmsMinistry[], CmsContentError>;
	readonly invalidate: (area: CmsCacheArea) => Effect.Effect<void, CmsContentError>;
}

/** The server's only way to read CMS content (Strapi 5, through `CmsContentV5Live`). */
export class CmsContent extends Context.Service<CmsContent, CmsContentContract>()("CmsContent") {}
