import { useCachedCampuses } from "@/hooks/relay/useCampuses";
import { useAuthenticatedUid, useUserProfile } from "@/hooks/relay/useUserData";
import {
  getCampusBySlug,
  getRequestedCampusSlug,
  PRIMARY_CAMPUS_SLUG,
} from "@/relay/campuses";

export function usePreferredCampus() {
  const uid = useAuthenticatedUid();
  const profile = useUserProfile();
  const campuses = useCachedCampuses();
  const savedSlug = uid ? profile?.preferredCampusSlug : null;
  const requestedSlug = getRequestedCampusSlug(savedSlug);
  const campus = getCampusBySlug(campuses, requestedSlug);
  // Keep the saved choice while the cache loads; fall back if it was removed.
  const slug =
    campus || campuses.length === 0 ? requestedSlug : PRIMARY_CAMPUS_SLUG;
  const name = getCampusBySlug(campuses, slug)?.campusName?.trim();
  const campusName = name?.length
    ? name
    : slug === PRIMARY_CAMPUS_SLUG
      ? "House of Stars"
      : slug
          .replace(/-/g, " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase());

  return {
    slug,
    campusName,
    hasSavedCampus: Boolean(savedSlug),
    isAuthenticated: Boolean(uid),
    isLoaded: !uid || Boolean(profile),
    version: profile?.campusPreferenceVersion ?? 0,
  };
}
