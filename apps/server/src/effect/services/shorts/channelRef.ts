/** The church's own channel (`@hgccnj`): the default when `SHORTS_DEFAULT_CHANNEL` is unset or unusable. */
export const BUILT_IN_CHANNEL_ID = "UC0CY5fmO82Cy3Dnso7dr5jg";

export type ChannelRef =
	| { readonly kind: "id"; readonly id: string }
	/** `handle` has no leading `@`. */
	| { readonly kind: "handle"; readonly handle: string };

const CHANNEL_ID = /^UC[\w-]{22}$/u;
const HANDLE = /^@(?<handle>[\w.-]+)$/u;
const YOUTUBE_URL_PATH = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(?<path>.+)$/iu;

/** Accepts a channel id, an `@handle`, or a youtube.com channel URL of either kind. */
export function parseChannelRef(input: string): ChannelRef | null {
	const value = input.trim();
	if (CHANNEL_ID.test(value)) {
		return { kind: "id", id: value };
	}
	const [first, second] = (YOUTUBE_URL_PATH.exec(value)?.groups?.path ?? value).split(/[/?#]/u);
	if (first === "channel" && second !== undefined && CHANNEL_ID.test(second)) {
		return { kind: "id", id: second };
	}
	const handle = HANDLE.exec(first ?? "")?.groups?.handle;
	return handle === undefined ? null : { kind: "handle", handle };
}

/**
 * A channel's Shorts are the playlist whose id swaps the channel id's `UC`
 * prefix for `UUSH`. YouTube does not document the prefix.
 */
export function shortsPlaylistId(channelId: string): string {
	return `UUSH${channelId.slice(2)}`;
}
