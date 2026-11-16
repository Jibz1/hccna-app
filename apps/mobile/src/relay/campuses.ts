import type { CampusesQuery$data } from "@/hooks/relay/__generated__/CampusesQuery.graphql";

export const PRIMARY_CAMPUS_SLUG = "house-of-stars";
export const HOUSE_OF_STARS_JUNIOR_CHURCH_SLUG = "house-of-stars-junior-church";

type CampusesResult = CampusesQuery$data["campusesV2"];
export type CampusData = Extract<
  CampusesResult,
  { readonly __typename: "CampusesSuccess" }
>["campuses"][number];

export function getRequestedCampusSlug(
  savedSlug: string | null | undefined,
): string {
  const slug = savedSlug?.trim();
  return slug?.length ? slug : PRIMARY_CAMPUS_SLUG;
}

export type GivingPlatformData = NonNullable<
  CampusData["givingPlatforms"]
>[number];

export function resolveCampuses(result: CampusesResult): readonly CampusData[] {
  if (result?.__typename === "CampusesFetchError") {
    throw new Error(result.message ?? "Unable to load campuses");
  }
  return result?.__typename === "CampusesSuccess" ? result.campuses : [];
}

export function getCampusBySlug(
  campuses: readonly CampusData[],
  slug: string | undefined,
): CampusData | null {
  return campuses.find((campus) => campus.slug === slug) ?? null;
}

export function getPrimaryCampus(
  campuses: readonly CampusData[],
): CampusData | null {
  return getCampusBySlug(campuses, PRIMARY_CAMPUS_SLUG);
}

export function getOtherCampusesWithGiving(
  campuses: readonly CampusData[],
): readonly CampusData[] {
  return campuses.filter(
    (campus) =>
      campus.slug !== PRIMARY_CAMPUS_SLUG &&
      (campus.givingPlatforms?.length ?? 0) > 0,
  );
}

export function sortCampusesPrimaryFirst(
  campuses: readonly CampusData[],
): CampusData[] {
  return [...campuses].sort((left, right) => {
    if (left.slug === PRIMARY_CAMPUS_SLUG) {
      return -1;
    }
    if (right.slug === PRIMARY_CAMPUS_SLUG) {
      return 1;
    }
    return (left.campusName ?? "").localeCompare(right.campusName ?? "");
  });
}
