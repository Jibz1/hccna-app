import { CAMPUS_SLUGS } from "@/utils/campuses";

/** A null status means no stream is mapped to this campus. */
export function getCampusLiveStatus(
	streams: readonly { slug?: string | undefined; isLive: boolean }[],
): Record<string, boolean | null> {
	const statuses: Record<string, boolean | null> = Object.fromEntries(
		CAMPUS_SLUGS.map((slug) => [slug, null]),
	);
	for (const stream of streams) {
		if (stream.slug && Object.hasOwn(statuses, stream.slug)) {
			statuses[stream.slug] = statuses[stream.slug] === true || stream.isLive;
		}
	}
	return statuses;
}
