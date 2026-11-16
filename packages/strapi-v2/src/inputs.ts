export interface CmsEventsFilter {
	/** Already defaulted by the caller; "house-of-stars" also includes events with no campus. */
	readonly campusSlug: string;
	/** CMS display value, e.g. "Weekly" or "Daily " (trimmed before use). */
	readonly reoccurring?: string | undefined;
	readonly slug?: string | undefined;
	/** "yyyy-MM-dd". When set, only events ending on/after this day or recurring ones, sorted by start. */
	readonly upcomingFrom?: string | undefined;
}

/**
 * A sermon's position in the newest-first order. Several sermons can share a date, so the
 * slug breaks ties: a date alone would skip the rest of that day.
 */
export interface CmsSermonCursor {
	readonly date: string;
	readonly slug: string;
}

export type CmsSermonsQuery =
	| { readonly kind: "slugs"; readonly slugs: readonly string[] }
	| {
			readonly kind: "page";
			readonly pageSize: number;
			/** Return sermons older than the cursor, newest first. */
			readonly after?: CmsSermonCursor | undefined;
			/** Return sermons newer than the cursor, oldest first. */
			readonly before?: CmsSermonCursor | undefined;
	  };
