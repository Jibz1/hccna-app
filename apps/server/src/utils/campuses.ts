import { Schema } from "effect";

export const CAMPUS_SLUGS = [
	"house-of-stars",
	"jubilee-place",
	"new-breed",
	"light-house",
	"impact-house",
	"house-of-grace",
] as const;

export const CampusSlugSchema = Schema.Literals(CAMPUS_SLUGS);
export type CampusSlug = typeof CampusSlugSchema.Type;
const DEFAULT_CAMPUS_SLUG: CampusSlug = "house-of-stars";

export const effectiveCampusSlug = (slug: string | null): CampusSlug =>
	Schema.is(CampusSlugSchema)(slug) ? slug : DEFAULT_CAMPUS_SLUG;

export const campusTopic = (slug: CampusSlug): string => `campus-${slug}`;
