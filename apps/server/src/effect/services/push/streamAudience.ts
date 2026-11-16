import {
	followCampusTopic,
	NOTIFICATION_PREFERENCES_TOPIC,
	NotificationCategoryTopic,
} from "@/effect/services/push/topics";
import { campusTopic, type CampusSlug } from "@/utils/campuses";
import { NotificationTopic } from "@/utils/messages";

// Server-managed membership distinguishes migrated devices without requiring
// older apps (including devices that never reopen) to register again.
export const CAMPUS_STREAM_AUDIENCE_TOPIC = "campus-stream-v2";

export function supportsCampusStreamNotifications(appVersion: string | null): boolean {
	const version = appVersion
		?.trim()
		.match(/^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u)?.groups;
	if (!version) {
		return false;
	}
	const major = Number(version.major);
	const minor = Number(version.minor);
	const patch = Number(version.patch);
	return (
		[major, minor, patch].every((part) => Number.isSafeInteger(part)) &&
		(major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch > 5))))
	);
}

type StreamNotificationTarget = { readonly condition: string };

const has = (topic: string) => `'${topic}' in topics`;

/**
 * Devices with notification settings (marked with NOTIFICATION_PREFERENCES_TOPIC)
 * and older devices are targeted by separate sends. The unmarked sends exclude the
 * marker, and registration never leaves a livestreams or follow topic without it,
 * so the audiences stay apart at every step of a registration.
 *
 * Each condition must be one FCM accepts: at most five topics, and each negation
 * parenthesized beside a positive topic in an `&&` that is the condition or sits
 * directly under its top-level `||`. FCM rejects a negation inside an `||` that is
 * itself inside an `&&` with INVALID_ARGUMENT.
 *
 * House of Stars also reaches unmarked devices outside campus mode (Union
 * subscribers). Registration puts every device in NotificationTopic, so its campus
 * members are `campus && announcement`, and the campus mode audience marker can be
 * dropped from the first branch to fit five topics. Keeping both audiences in one
 * condition matters: FCM evaluates a message once per device, while separate sends
 * would notify a device twice if it left campus mode (or logged out) between them.
 */
export function streamNotificationTargets(
	campus: CampusSlug,
	campusDeliveryEnabled: boolean,
): readonly StreamNotificationTarget[] {
	const marked = has(NOTIFICATION_PREFERENCES_TOPIC);
	const livestreams = has(NotificationCategoryTopic.livestreams);
	const followers = has(followCampusTopic(campus));
	if (!campusDeliveryEnabled) {
		return campus === "house-of-stars"
			? [
					{ condition: `${has(NotificationTopic)} && !(${marked})` },
					{ condition: `${livestreams} || ${followers}` },
				]
			: [];
	}
	const campusMembers = has(campusTopic(campus));
	const audience = has(CAMPUS_STREAM_AUDIENCE_TOPIC);
	const unmarkedAudience =
		campus === "house-of-stars"
			? `(${campusMembers} && !(${marked})) || (${has(NotificationTopic)} && !(${audience}) && !(${marked}))`
			: `${campusMembers} && ${audience} && !(${marked})`;
	return [
		{ condition: `(${campusMembers} && ${livestreams}) || ${followers}` },
		{ condition: unmarkedAudience },
	];
}
