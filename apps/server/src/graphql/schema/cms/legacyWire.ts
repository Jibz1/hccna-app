import { cashTag } from "@/effect/services/giving/platforms";

import type { CmsGivingEntry, CmsLeader, CmsSpeaker } from "@hccnj/strapi-v2";

/*
 * Records keep the CMS's structure. These functions are the only place that turns
 * them back into the strings app 2.0 already receives.
 */

const LEAD_PASTOR_GROUP = "Lead Pastors/Campus Leads";

/** `Campus.giving`: "$tag; Zelle - account" in CMS order. Other platforms are not part of the text. */
export const givingText = (entries: readonly CmsGivingEntry[]): string | undefined => {
	const parts = entries.flatMap((entry) => {
		if (entry.platform === "Cashapp") {
			return [cashTag(entry.value)];
		}
		if (entry.platform === "Zelle") {
			return [`Zelle - ${entry.value}`];
		}
		return [];
	});
	return parts.length > 0 ? parts.join("; ") : undefined;
};

/** `EventSpeaker.fullName`: name, then title on the next line. */
export const speakerFullName = (speaker: CmsSpeaker): string | null =>
	speaker.title === null ? speaker.fullName : `${speaker.fullName ?? ""}\n${speaker.title}`;

/** The first Lead Pastor/Campus Lead, otherwise the first leader in the order editors set. */
export const leadPastorOf = (leaders: readonly CmsLeader[]): CmsLeader | undefined =>
	leaders.find((leader) => leader.group === LEAD_PASTOR_GROUP) ?? leaders[0];
