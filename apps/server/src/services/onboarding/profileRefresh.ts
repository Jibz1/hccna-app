import { FALLBACK_NAMES } from "@/services/onboarding/userProvisioning";
import { Duration } from "effect";

interface ProfileNames {
	readonly firstName?: string | null;
	readonly lastName?: string | null;
}

export interface RefreshableProfile extends ProfileNames {
	readonly enrichmentPending?: boolean;
	readonly ccbProfileCheckedAt?: Date | null;
}

// Leave a day's grace so weekly app opens don't miss the gate by a few minutes.
const REFRESH_INTERVAL_MS = Duration.toMillis(Duration.days(6));
const INCOMPLETE_RETRY_MS = Duration.toMillis(Duration.days(1));

/**
 * A name field still holding one of the buildOnboardingUserDoc fallbacks
 * ("Hi"/"There" for Google sign-ins, "Anonymous" otherwise). Only such fields
 * are ever auto-repaired; anything a user typed themselves is never
 * overwritten.
 */
export const hasPlaceholderName = (profile: ProfileNames): boolean =>
	FALLBACK_NAMES.has(profile.firstName ?? "") || FALLBACK_NAMES.has(profile.lastName ?? "");

/** Enrichment never finished, or a name is still a signup fallback. */
export const isIncompleteProfile = (profile: RefreshableProfile): boolean =>
	profile.enrichmentPending === true || hasPlaceholderName(profile);

/**
 * Every terminal job outcome records a check: a match, a successful directory miss, or a
 * skipped identity mismatch. Failures leave the profile due. Incomplete profiles come due
 * daily instead of weekly, so a profile the directory cannot complete is not looked up on
 * every read.
 */
export function needsCcbProfileRefresh(
	profile: RefreshableProfile,
	nowMs: number,
	incomplete = isIncompleteProfile(profile),
): boolean {
	if (!profile.ccbProfileCheckedAt) {
		return true;
	}
	const interval = incomplete ? INCOMPLETE_RETRY_MS : REFRESH_INTERVAL_MS;
	return nowMs - profile.ccbProfileCheckedAt.getTime() >= interval;
}
