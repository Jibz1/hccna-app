import { serviceRequest } from "@/utils/serviceRequest";
import { Effect, Option, Redacted, Schema } from "effect";

const BASE_URL = "https://www.googleapis.com/youtube/v3";
/** The most the Data API returns per page or accepts per `videos.list` call. */
const PAGE_SIZE = 50;

type YouTubeAction = "channels.list" | "playlistItems.list" | "videos.list";

export class YouTubeApiError extends Schema.TaggedError<YouTubeApiError>()("YouTubeApiError", {
	action: Schema.String,
	status: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `YouTube ${this.action} failed${this.status === undefined ? "" : ` with status ${this.status}`}`;
	}
}

export interface YouTubeVideo {
	readonly videoId: string;
	readonly title: string;
	readonly channelTitle: string;
	readonly thumbnail: string | null;
	readonly isPublic: boolean;
	readonly embeddable: boolean;
}

const Channel = Schema.Struct({ id: Schema.String });
const Channels = Schema.Array(Channel);
const ChannelsResponse = Schema.Struct({ items: Schema.optional(Channels) });

const PlaylistItemDetails = Schema.Struct({ videoId: Schema.String });
const PlaylistItem = Schema.Struct({ contentDetails: PlaylistItemDetails });
const PlaylistItems = Schema.Array(PlaylistItem);
const PlaylistItemsResponse = Schema.Struct({
	items: Schema.optional(PlaylistItems),
	nextPageToken: Schema.optional(Schema.String),
});

const ThumbnailImage = Schema.Struct({ url: Schema.String });
const Thumbnail = Schema.optional(ThumbnailImage);
const Thumbnails = Schema.Struct({ high: Thumbnail, medium: Thumbnail, default: Thumbnail });
const VideoSnippet = Schema.Struct({
	title: Schema.String,
	channelTitle: Schema.String,
	thumbnails: Schema.optional(Thumbnails),
});
const VideoStatus = Schema.Struct({
	privacyStatus: Schema.String,
	embeddable: Schema.optional(Schema.Boolean),
});
const Video = Schema.Struct({ id: Schema.String, snippet: VideoSnippet, status: VideoStatus });
const Videos = Schema.Array(Video);
const VideosResponse = Schema.Struct({ items: Schema.optional(Videos) });

const toYouTubeVideo = (item: typeof Video.Type): YouTubeVideo => {
	const { thumbnails } = item.snippet;
	return {
		videoId: item.id,
		title: item.snippet.title,
		channelTitle: item.snippet.channelTitle,
		thumbnail: thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null,
		isPublic: item.status.privacyStatus === "public",
		embeddable: item.status.embeddable === true,
	};
};

/** Reports a response shape YouTube did not promise as that action's failure. */
const asMalformed =
	(action: YouTubeAction) =>
	<A, E>(decoding: Effect.Effect<A, E>) =>
		Effect.mapError(decoding, (cause) => new YouTubeApiError({ action, cause }));

export const makeYouTubeApi = (apiKey: Redacted.Redacted<string>) => {
	/** The JSON body of a successful call. The key travels in a header so it never lands in a logged URL. */
	const get = Effect.fn("YouTubeApi.get")(function* (
		action: YouTubeAction,
		path: string,
		params: URLSearchParams,
	) {
		const request = () =>
			serviceRequest({
				url: `${BASE_URL}/${path}?${params.toString()}`,
				options: { headers: { "X-Goog-Api-Key": Redacted.value(apiKey) } },
				service: "youtube",
				action,
			});
		const response = yield* Effect.tryPromise({
			try: request,
			catch: (cause) => new YouTubeApiError({ action, cause }),
		});
		if (!response.ok) {
			return yield* Effect.fail(new YouTubeApiError({ action, status: response.status }));
		}
		return yield* Effect.tryPromise({
			try: (): Promise<unknown> => response.json(),
			catch: (cause) => new YouTubeApiError({ action, status: response.status, cause }),
		});
	});

	const getVideoBatch = Effect.fn("YouTubeApi.getVideoBatch")(function* (ids: readonly string[]) {
		const params = new URLSearchParams({ part: "snippet,status", id: ids.join(",") });
		const body = yield* get("videos.list", "videos", params);
		const decoding = Schema.decodeUnknownEffect(VideosResponse)(body);
		const response = yield* asMalformed("videos.list")(decoding);
		return (response.items ?? []).map((item) => toYouTubeVideo(item));
	});

	const getPlaylistPage = Effect.fn("YouTubeApi.getPlaylistPage")(function* (
		playlistId: string,
		pageToken: string | null,
	) {
		const params = new URLSearchParams({
			part: "contentDetails",
			playlistId,
			maxResults: String(PAGE_SIZE),
		});
		if (pageToken !== null) {
			params.set("pageToken", pageToken);
		}
		const body = yield* get("playlistItems.list", "playlistItems", params);
		const decoding = Schema.decodeUnknownEffect(PlaylistItemsResponse)(body);
		return yield* asMalformed("playlistItems.list")(decoding);
	});

	return {
		/** None when YouTube answers but knows no channel by that handle. */
		resolveChannelId: Effect.fn("YouTubeApi.resolveChannelId")(function* (handle: string) {
			const params = new URLSearchParams({ part: "id", forHandle: handle });
			const body = yield* get("channels.list", "channels", params);
			const decoding = Schema.decodeUnknownEffect(ChannelsResponse)(body);
			const response = yield* asMalformed("channels.list")(decoding);
			return Option.fromUndefinedOr(response.items?.[0]?.id);
		}),

		/** Newest first, at most `limit` ids, following nextPageToken. */
		listPlaylistVideoIds: Effect.fn("YouTubeApi.listPlaylistVideoIds")(function* (
			playlistId: string,
			limit: number,
		) {
			const ids: string[] = [];
			let pageToken: string | null = null;
			// Bounded by the limit, not by YouTube's tokens, so a misbehaving
			// response cannot keep the loop going.
			for (let page = 0; page < Math.ceil(limit / PAGE_SIZE); page += 1) {
				const response: typeof PlaylistItemsResponse.Type = yield* getPlaylistPage(
					playlistId,
					pageToken,
				);
				for (const item of response.items ?? []) {
					ids.push(item.contentDetails.videoId);
				}
				pageToken = response.nextPageToken ?? null;
				if (pageToken === null) {
					break;
				}
			}
			return ids.slice(0, limit);
		}),

		/** Batches of 50. Ids YouTube omits are absent from the result. */
		getVideos: Effect.fn("YouTubeApi.getVideos")(function* (ids: readonly string[]) {
			const videos: YouTubeVideo[] = [];
			for (let start = 0; start < ids.length; start += PAGE_SIZE) {
				const batch = yield* getVideoBatch(ids.slice(start, start + PAGE_SIZE));
				videos.push(...batch);
			}
			return videos;
		}),
	};
};

export type YouTubeApi = ReturnType<typeof makeYouTubeApi>;
