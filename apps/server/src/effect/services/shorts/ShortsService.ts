import { CACHE_POLICIES } from "@/effect/cache/policies";
import { createTwoTierCache } from "@/effect/cache/TwoTierCache";
import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";

import {
	BUILT_IN_CHANNEL_ID,
	parseChannelRef,
	shortsPlaylistId,
	type ChannelRef,
} from "./channelRef";
import { makeYouTubeApi, YouTubeApiError, type YouTubeApi } from "./YouTubeApi";

/** The most shorts one response carries. */
const MAX_SHORTS = 500;
const VIDEO_ID = /^[\w-]{11}$/u;

// A type alias, not an interface: the cache stores JSON values, and only an
// alias is assignable to its index-signature value type.
export type ShortItem = {
	readonly videoId: string;
	readonly title: string;
	readonly channelTitle: string;
	readonly thumbnail: string | null;
	/** True for a hand-picked short. Nothing is hand-picked until the CMS entry exists. */
	readonly curated: boolean;
};

interface ShortsServiceContract {
	/** Never fails: any failure with no usable cached list yields []. */
	readonly list: Effect.Effect<readonly ShortItem[]>;
}

const shortsConfig = Config.all({
	apiKey: Config.option(Config.Redacted("YOUTUBE_API_KEY")),
	defaultChannel: Config.String("SHORTS_DEFAULT_CHANNEL").pipe(
		Config.withDefault(BUILT_IN_CHANNEL_ID),
	),
});

const NO_SHORTS: readonly ShortItem[] = [];

/** The service with its YouTube client injected; `api` is null when no key is configured. */
export const makeShortsService = Effect.fn("ShortsService.make")(function* (deps: {
	readonly api: YouTubeApi | null;
	/** Raw `SHORTS_DEFAULT_CHANNEL` value, or the built-in channel id. */
	readonly defaultChannel: string;
}) {
	const redis = yield* RedisService;
	const lru = yield* LRUService;
	const { api } = deps;
	if (api === null) {
		return { list: Effect.succeed(NO_SHORTS) } satisfies ShortsServiceContract;
	}

	const configured = parseChannelRef(deps.defaultChannel);
	if (configured === null) {
		// The default channel is always in the feed, so a typo falls back rather than emptying it.
		yield* Effect.logWarning(
			"ShortsService: SHORTS_DEFAULT_CHANNEL is not a YouTube channel; using the built-in channel",
		);
	}
	const builtIn: ChannelRef = { kind: "id", id: BUILT_IN_CHANNEL_ID };
	const channel = configured ?? builtIn;
	const cache = createTwoTierCache<readonly ShortItem[]>({ lru, redis }, CACHE_POLICIES.shorts);
	// Keyed by channel so a changed default never serves the old channel's list.
	const cacheKey = channel.kind === "id" ? channel.id : `@${channel.handle}`;

	/** The newest Shorts ids of a channel; none when YouTube has no such channel or playlist. */
	const listShortIds = Effect.fn("ShortsService.listShortIds")(function* (ref: ChannelRef) {
		const channelId =
			ref.kind === "id" ? Option.some(ref.id) : yield* api.resolveChannelId(ref.handle);
		if (Option.isNone(channelId)) {
			return Option.none<readonly string[]>();
		}
		return yield* api.listPlaylistVideoIds(shortsPlaylistId(channelId.value), MAX_SHORTS).pipe(
			Effect.map((ids) => Option.some<readonly string[]>(ids)),
			Effect.catchIf(
				(error) => error.status === 404,
				() => Effect.succeed(Option.none<readonly string[]>()),
			),
		);
	});

	const listIds = Effect.gen(function* () {
		const ids = yield* listShortIds(channel);
		if (Option.isSome(ids)) {
			return ids.value;
		}
		if (channel !== builtIn) {
			// A well-formed value that names no channel is still a typo: the default
			// channel is always in the feed, so it falls back instead of emptying it.
			yield* Effect.logWarning(
				"ShortsService: SHORTS_DEFAULT_CHANNEL has no Shorts on YouTube; using the built-in channel",
			);
			const fallback = yield* listShortIds(builtIn);
			if (Option.isSome(fallback)) {
				return fallback.value;
			}
		}
		return yield* Effect.fail(new YouTubeApiError({ action: "playlistItems.list", status: 404 }));
	});

	const load = Effect.gen(function* () {
		const ids = yield* listIds;
		const found = yield* api.getVideos(ids);
		const videos = new Map(found.map((video) => [video.videoId, video] as const));
		const shorts = new Map<string, ShortItem>();
		for (const id of ids) {
			const video = videos.get(id);
			// Other channels' owners can block in-app playback, and a video can go
			// private between the two calls; neither may reach the feed.
			if (video?.isPublic && video.embeddable && VIDEO_ID.test(id) && !shorts.has(id)) {
				shorts.set(id, {
					videoId: id,
					title: video.title,
					channelTitle: video.channelTitle,
					thumbnail: video.thumbnail,
					curated: false,
				});
			}
		}
		return [...shorts.values()].slice(0, MAX_SHORTS);
	}).pipe(
		Effect.tapError((error) =>
			Effect.logWarning("ShortsService: loading shorts from YouTube failed").pipe(
				Effect.annotateLogs({ action: error.action, status: error.status }),
			),
		),
	);

	return {
		// Within the stale window the cache answers and refreshes in the background,
		// so a YouTube failure only surfaces here when there has never been a good list.
		list: cache.getOrLoad(cacheKey, load).pipe(
			Effect.map((cached) => cached.value),
			Effect.catch(() => Effect.succeed(NO_SHORTS)),
		),
	} satisfies ShortsServiceContract;
});

export class ShortsService extends Context.Service<ShortsService, ShortsServiceContract>()(
	"ShortsService",
	{
		make: Effect.gen(function* () {
			const { apiKey, defaultChannel } = yield* shortsConfig;
			const key = Option.filter(apiKey, (value) => Redacted.value(value).trim() !== "");
			if (Option.isNone(key)) {
				yield* Effect.logWarning(
					"ShortsService: YOUTUBE_API_KEY is not set; the shorts feed is empty",
				);
			}
			return yield* makeShortsService({
				api: Option.match(key, { onNone: () => null, onSome: makeYouTubeApi }),
				defaultChannel,
			});
		}),
	},
) {}

export const ShortsServiceLive = Layer.effect(ShortsService, ShortsService.make);
