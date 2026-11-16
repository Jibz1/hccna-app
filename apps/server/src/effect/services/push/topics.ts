import { CAMPUS_SLUGS, type CampusSlug } from "@/utils/campuses";
import { NotificationTopic } from "@/utils/messages";

// FCM constrains topic names to this charset (max 900 chars).
const FCM_TOPIC_PATTERN = /^[a-zA-Z0-9-_.~%]{1,900}$/u;

export const isValidTopic = (topic: string): boolean => FCM_TOPIC_PATTERN.test(topic);

/**
 * Apps with notification settings register this marker alongside the category
 * topics the user kept on. Senders deliver a category to marked devices only
 * through its topic, and to unmarked (older) devices through `announcement`.
 */
export const NOTIFICATION_PREFERENCES_TOPIC = "notify-prefs-v1";

export const NotificationCategoryTopic = {
	verseOfTheDay: "verse-of-the-day",
	livestreams: "livestreams",
	wordOfActivation: "word-of-activation",
} as const;
export type NotificationCategory =
	(typeof NotificationCategoryTopic)[keyof typeof NotificationCategoryTopic];

const CATEGORY_TOPICS = new Set<string>(Object.values(NotificationCategoryTopic));
const FOLLOW_CAMPUS_PREFIX = "follow-";

/** A campus whose livestreams this device follows in addition to its own campus. */
export const followCampusTopic = (slug: CampusSlug): string => `${FOLLOW_CAMPUS_PREFIX}${slug}`;

const FOLLOW_CAMPUS_TOPICS = new Set<string>(CAMPUS_SLUGS.map((slug) => followCampusTopic(slug)));

/** Topics whose meaning depends on the device also carrying the preferences marker. */
export const isPreferenceTopic = (topic: string): boolean =>
	topic === NOTIFICATION_PREFERENCES_TOPIC ||
	CATEGORY_TOPICS.has(topic) ||
	topic.startsWith(FOLLOW_CAMPUS_PREFIX);

/** Whether a device's saved topics allow a category; unmarked devices receive every category. */
export const allowsCategory = (
	topics: readonly unknown[],
	category: NotificationCategory,
): boolean => !topics.includes(NOTIFICATION_PREFERENCES_TOPIC) || topics.includes(category);

/**
 * FCM condition for a category sent to every device at once: marked devices
 * through the category topic, older devices through the shared announcement topic.
 */
export const categoryCondition = (category: NotificationCategory): string =>
	`'${category}' in topics || ('${NotificationTopic}' in topics && !('${NOTIFICATION_PREFERENCES_TOPIC}' in topics))`;

/** Every preference topic a registration can subscribe, marker first. */
export const PREFERENCE_TOPICS: readonly string[] = [
	NOTIFICATION_PREFERENCES_TOPIC,
	...CATEGORY_TOPICS,
	...FOLLOW_CAMPUS_TOPICS,
];

const isKnownPreferenceTopic = (topic: string): boolean => PREFERENCE_TOPICS.includes(topic);

/**
 * Normalizes client-supplied channels into the FCM topics a device should be
 * subscribed to. Every device is always subscribed to the shared announcement
 * topic so existing broadcast senders keep reaching all registered devices.
 *
 * Preference topics are kept only for devices that also receive campus stream
 * delivery. Devices outside it keep the older receive-everything behavior.
 */
export const normalizeTopics = (
	channels?: readonly (string | null | undefined)[] | null,
	options: { readonly allowPreferences?: boolean } = {},
): string[] => {
	const topics = new Set<string>([NotificationTopic]);
	for (const channel of channels ?? []) {
		const allowed =
			channel &&
			isValidTopic(channel) &&
			(!isPreferenceTopic(channel) ||
				(options.allowPreferences === true && isKnownPreferenceTopic(channel)));
		if (allowed) {
			topics.add(channel);
		}
	}
	// Category and follow topics without the marker would put a device in both stream audiences.
	return topics.has(NOTIFICATION_PREFERENCES_TOPIC)
		? [...topics]
		: [...topics].filter((topic) => !isPreferenceTopic(topic));
};
