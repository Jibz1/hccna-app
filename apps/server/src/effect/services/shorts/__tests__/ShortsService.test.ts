import { LRUService } from "@/effect/LRUService";
import { makeMemoryRedis } from "@/graphql/__tests__/utils/memoryRedis";
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";

import { makeShortsService } from "../ShortsService";
import { YouTubeApiError, type YouTubeApi, type YouTubeVideo } from "../YouTubeApi";

const id = (n: number) => `aaaaaaaaa${String(n).padStart(2, "0")}`;

const video = (videoId: string, overrides: Partial<YouTubeVideo> = {}): YouTubeVideo => ({
	videoId,
	title: `Sample short ${videoId}`,
	channelTitle: "Example Channel",
	thumbnail: `https://example.com/${videoId}.jpg`,
	isPublic: true,
	embeddable: true,
	...overrides,
});

/** A hand-written YouTubeApi that records its calls and can be told to fail. */
function makeFakeApi(options: {
	playlist: readonly string[];
	videos?: readonly YouTubeVideo[];
	/** What the handle resolves to; null means YouTube knows no such channel. */
	channelId?: string | null;
	/** Playlists YouTube answers 404 for. */
	missingPlaylists?: readonly string[];
}) {
	const calls = {
		resolveChannelId: [] as string[],
		listPlaylistVideoIds: [] as { playlistId: string; limit: number }[],
		getVideos: 0,
	};
	const state = { failing: false };
	const quotaExceeded = (action: string) =>
		Effect.fail(new YouTubeApiError({ action, status: 403 }));
	const api: YouTubeApi = {
		resolveChannelId: (handle) => {
			calls.resolveChannelId.push(handle);
			return Effect.succeed(
				options.channelId === null
					? Option.none()
					: Option.some(options.channelId ?? "UCbbbbbbbbbbbbbbbbbbbbbb"),
			);
		},
		listPlaylistVideoIds: (playlistId, limit) => {
			calls.listPlaylistVideoIds.push({ playlistId, limit });
			if (options.missingPlaylists?.includes(playlistId)) {
				return Effect.fail(new YouTubeApiError({ action: "playlistItems.list", status: 404 }));
			}
			return state.failing
				? quotaExceeded("playlistItems.list")
				: Effect.succeed([...options.playlist]);
		},
		getVideos: (ids) => {
			calls.getVideos += 1;
			const videos = options.videos ?? ids.map((videoId) => video(videoId));
			return state.failing
				? quotaExceeded("videos.list")
				: Effect.succeed(videos.filter((item) => ids.includes(item.videoId)));
		},
	};
	return { api, calls, state };
}

function makeTestLayer() {
	const lru = new Map<string, unknown>();
	return Layer.mergeAll(
		makeMemoryRedis().layer,
		Layer.succeed(LRUService, {
			get: (key: string) => Effect.sync(() => lru.get(key)),
			set: <T>(key: string, value: T) =>
				Effect.sync(() => {
					lru.set(key, value);
				}),
			delete: (key: string) => Effect.sync(() => lru.delete(key)),
		} as never),
		TestClock.layer(),
	);
}

const run = <A>(
	program: Effect.Effect<A, never, Layer.Success<ReturnType<typeof makeTestLayer>>>,
) => Effect.runPromise(program.pipe(Effect.provide(makeTestLayer())));

const listWith = (api: YouTubeApi | null, defaultChannel = "UCaaaaaaaaaaaaaaaaaaaaaa") =>
	run(
		Effect.gen(function* () {
			const service = yield* makeShortsService({ api, defaultChannel });
			return yield* service.list;
		}),
	);

describe("ShortsService", () => {
	it("returns public embeddable shorts in playlist order", async () => {
		const fake = makeFakeApi({
			playlist: [id(1), id(2), id(3), id(4)],
			videos: [
				video(id(4)),
				video(id(3), { embeddable: false }),
				video(id(2), { isPublic: false }),
				video(id(1), { thumbnail: null }),
			],
		});

		const shorts = await listWith(fake.api);

		expect(shorts).toEqual([
			{
				videoId: id(1),
				title: `Sample short ${id(1)}`,
				channelTitle: "Example Channel",
				thumbnail: null,
				curated: false,
			},
			{
				videoId: id(4),
				title: `Sample short ${id(4)}`,
				channelTitle: "Example Channel",
				thumbnail: `https://example.com/${id(4)}.jpg`,
				curated: false,
			},
		]);
		expect(fake.calls.listPlaylistVideoIds).toEqual([
			{ playlistId: "UUSHaaaaaaaaaaaaaaaaaaaaaa", limit: 500 },
		]);
	});

	it("drops ids that videos.list omits", async () => {
		const fake = makeFakeApi({
			playlist: [id(1), id(2), id(3)],
			videos: [video(id(1)), video(id(3))],
		});

		const shorts = await listWith(fake.api);

		expect(shorts.map((item) => item.videoId)).toEqual([id(1), id(3)]);
	});

	it("drops ids that are not YouTube video ids", async () => {
		const fake = makeFakeApi({ playlist: [id(1), "not a video id"] });

		const shorts = await listWith(fake.api);

		expect(shorts.map((item) => item.videoId)).toEqual([id(1)]);
	});

	it("removes duplicate ids", async () => {
		const fake = makeFakeApi({ playlist: [id(1), id(1), id(2)] });

		const shorts = await listWith(fake.api);

		expect(shorts.map((item) => item.videoId)).toEqual([id(1), id(2)]);
	});

	it("caps the list at 500", async () => {
		const playlist = Array.from(
			{ length: 600 },
			(_, index) => `b${String(index).padStart(10, "0")}`,
		);
		const fake = makeFakeApi({ playlist });

		const shorts = await listWith(fake.api);

		expect(shorts).toHaveLength(500);
		expect(shorts[499]?.videoId).toBe(playlist[499]);
	});

	it("returns [] and calls nothing without a key", async () => {
		const shorts = await listWith(null);

		expect(shorts).toEqual([]);
	});

	it("falls back to the built-in channel", async () => {
		const fake = makeFakeApi({ playlist: [id(1)] });

		const shorts = await listWith(fake.api, "not a channel");

		expect(shorts).toHaveLength(1);
		expect(fake.calls.resolveChannelId).toEqual([]);
		expect(fake.calls.listPlaylistVideoIds[0]?.playlistId).toBe("UUSH0CY5fmO82Cy3Dnso7dr5jg");
	});

	it("falls back to the built-in channel when the handle matches no channel", async () => {
		const fake = makeFakeApi({ playlist: [id(1)], channelId: null });

		const shorts = await listWith(fake.api, "@examplechannell");

		expect(shorts.map((item) => item.videoId)).toEqual([id(1)]);
		expect(fake.calls.listPlaylistVideoIds.map((call) => call.playlistId)).toEqual([
			"UUSH0CY5fmO82Cy3Dnso7dr5jg",
		]);
	});

	it("falls back to the built-in channel when the channel has no shorts playlist", async () => {
		const fake = makeFakeApi({
			playlist: [id(1)],
			missingPlaylists: ["UUSHeeeeeeeeeeeeeeeeeeeeee"],
		});

		const shorts = await listWith(fake.api, "UCeeeeeeeeeeeeeeeeeeeeee");

		expect(shorts.map((item) => item.videoId)).toEqual([id(1)]);
		expect(fake.calls.listPlaylistVideoIds.map((call) => call.playlistId)).toEqual([
			"UUSHeeeeeeeeeeeeeeeeeeeeee",
			"UUSH0CY5fmO82Cy3Dnso7dr5jg",
		]);
	});

	it("does not swap channels when YouTube fails for another reason", async () => {
		const fake = makeFakeApi({ playlist: [id(1)] });
		fake.state.failing = true;

		const shorts = await listWith(fake.api, "UCeeeeeeeeeeeeeeeeeeeeee");

		expect(shorts).toEqual([]);
		expect(fake.calls.listPlaylistVideoIds.map((call) => call.playlistId)).toEqual([
			"UUSHeeeeeeeeeeeeeeeeeeeeee",
		]);
	});

	it("resolves a handle before listing", async () => {
		const fake = makeFakeApi({ playlist: [id(1)], channelId: "UCcccccccccccccccccccccc" });

		await listWith(fake.api, "https://www.youtube.com/@examplechannel/shorts");

		expect(fake.calls.resolveChannelId).toEqual(["examplechannel"]);
		expect(fake.calls.listPlaylistVideoIds[0]?.playlistId).toBe("UUSHcccccccccccccccccccccc");
	});

	it("serves the cached list within the hour", async () => {
		const fake = makeFakeApi({ playlist: [id(1), id(2)] });

		const [first, second] = await run(
			Effect.gen(function* () {
				const service = yield* makeShortsService({
					api: fake.api,
					defaultChannel: "UCaaaaaaaaaaaaaaaaaaaaaa",
				});
				const before = yield* service.list;
				yield* TestClock.adjust("10 minutes");
				return [before, yield* service.list] as const;
			}),
		);

		expect(second).toEqual(first);
		expect(fake.calls.listPlaylistVideoIds).toHaveLength(1);
	});

	it("serves the last good list when YouTube fails", async () => {
		const fake = makeFakeApi({ playlist: [id(1), id(2)] });

		const [first, second] = await run(
			Effect.gen(function* () {
				const service = yield* makeShortsService({
					api: fake.api,
					defaultChannel: "UCaaaaaaaaaaaaaaaaaaaaaa",
				});
				const before = yield* service.list;
				yield* TestClock.adjust("2 hours");
				fake.state.failing = true;
				return [before, yield* service.list] as const;
			}),
		);

		expect(first.map((item) => item.videoId)).toEqual([id(1), id(2)]);
		expect(second).toEqual(first);
	});

	it("returns [] when the first load fails", async () => {
		const fake = makeFakeApi({ playlist: [id(1)] });
		fake.state.failing = true;

		const shorts = await listWith(fake.api);

		expect(shorts).toEqual([]);
	});

	it("keeps each channel's list apart", async () => {
		const first = makeFakeApi({ playlist: [id(1)] });
		const second = makeFakeApi({ playlist: [id(2)] });

		const lists = await run(
			Effect.gen(function* () {
				const one = yield* makeShortsService({
					api: first.api,
					defaultChannel: "UCaaaaaaaaaaaaaaaaaaaaaa",
				});
				const two = yield* makeShortsService({
					api: second.api,
					defaultChannel: "UCdddddddddddddddddddddd",
				});
				return [yield* one.list, yield* two.list] as const;
			}),
		);

		expect(lists[0].map((item) => item.videoId)).toEqual([id(1)]);
		expect(lists[1].map((item) => item.videoId)).toEqual([id(2)]);
	});
});
