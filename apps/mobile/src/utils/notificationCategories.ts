// Topic names mirror apps/server/src/effect/services/push/topics.ts.
const NOTIFICATION_PREFERENCES_CHANNEL = "notify-prefs-v1";

export const NOTIFICATION_CATEGORIES = [
  {
    channel: "verse-of-the-day",
    title: "Verse of the Day",
    description: "A daily verse",
    icon: "book-bible",
  },
  {
    channel: "livestreams",
    title: "Livestreams",
    description: "When your campus goes live",
    icon: "tower-broadcast",
  },
  {
    channel: "word-of-activation",
    title: "Word of Activation",
    description: "Your monthly word",
    icon: "wand-magic-sparkles",
  },
] as const;

export type NotificationCategoryChannel =
  (typeof NOTIFICATION_CATEGORIES)[number]["channel"];

/**
 * Registration channels for this device. Categories are stored as an opt-out
 * list, so a category added later starts on. The device's own campus is left to
 * the Livestreams category, even if it was followed before it became the campus.
 */
export function notificationChannels(
  categoriesOff: readonly string[] | null | undefined,
  followedCampusSlugs?: readonly string[] | null,
  ownCampusSlug?: string,
): string[] {
  const off = new Set(categoriesOff);
  return [
    NOTIFICATION_PREFERENCES_CHANNEL,
    ...NOTIFICATION_CATEGORIES.map((category) => category.channel).filter(
      (channel) => !off.has(channel),
    ),
    ...(followedCampusSlugs ?? [])
      .filter((slug) => slug !== ownCampusSlug)
      .map((slug) => `follow-${slug}`),
  ];
}

function withMember(
  list: readonly string[] | null | undefined,
  value: string,
  present: boolean,
): string[] {
  const members = new Set(list);
  if (present) {
    members.add(value);
  } else {
    members.delete(value);
  }
  return [...members].sort();
}

export const setNotificationCategory = (
  categoriesOff: readonly string[] | null | undefined,
  channel: NotificationCategoryChannel,
  enabled: boolean,
): string[] => withMember(categoriesOff, channel, !enabled);

export const setFollowedCampus = (
  followedCampusSlugs: readonly string[] | null | undefined,
  campusSlug: string,
  following: boolean,
): string[] => withMember(followedCampusSlugs, campusSlug, following);
