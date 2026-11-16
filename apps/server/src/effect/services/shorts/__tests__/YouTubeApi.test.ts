import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect, Option, Redacted } from "effect";

import type { serviceRequest as serviceRequestFn } from "@/utils/serviceRequest";

type ServiceRequestInput = Parameters<typeof serviceRequestFn>[0];

const requests: ServiceRequestInput[] = [];
let respond: (input: ServiceRequestInput, call: number) => { status: number; body: unknown };

const mockServiceRequest = mock((input: ServiceRequestInput) => {
	requests.push(input);
	const { status, body } = respond(input, requests.length);
	return Promise.resolve({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	} as Response);
});

void mock.module("@/utils/serviceRequest", () => ({ serviceRequest: mockServiceRequest }));

const { makeYouTubeApi, YouTubeApiError } = await import("../YouTubeApi");

const api = makeYouTubeApi(Redacted.make("test-key"));

const videoId = (n: number) => `v${String(n).padStart(10, "0")}`;
const playlistPage = (from: number, count: number, nextPageToken?: string) => {
	const items = Array.from({ length: count }, (_, index) => ({
		contentDetails: { videoId: videoId(from + index) },
	}));
	return nextPageToken === undefined ? { items } : { items, nextPageToken };
};
type VideoItem = {
	id: string;
	snippet: {
		title: string;
		channelTitle: string;
		thumbnails?: { high?: { url: string }; default?: { url: string } };
	};
	status: { privacyStatus: string; embeddable: boolean };
};
const video = (id: string, overrides: Partial<Omit<VideoItem, "id">> = {}): VideoItem => ({
	id,
	snippet: {
		title: `Sample short ${id}`,
		channelTitle: "Example Channel",
		thumbnails: { high: { url: `https://example.com/${id}/high.jpg` } },
	},
	status: { privacyStatus: "public", embeddable: true },
	...overrides,
});
const query = (input: ServiceRequestInput) => new URL(input.url).searchParams;

beforeEach(() => {
	requests.length = 0;
	mockServiceRequest.mockClear();
});

describe("makeYouTubeApi", () => {
	it("sends the key in a header, not the URL", async () => {
		respond = () => ({ status: 200, body: playlistPage(1, 1) });

		await Effect.runPromise(api.listPlaylistVideoIds("UUSHexample", 10));

		expect(requests[0]?.url).not.toContain("test-key");
		expect(new Headers(requests[0]?.options?.headers).get("X-Goog-Api-Key")).toBe("test-key");
		expect(requests[0]?.service).toBe("youtube");
		expect(requests[0]?.action).toBe("playlistItems.list");
	});

	it("follows pages until the limit", async () => {
		respond = (_input, call) => ({
			status: 200,
			body: playlistPage((call - 1) * 50 + 1, 50, `page-${call + 1}`),
		});

		const ids = await Effect.runPromise(api.listPlaylistVideoIds("UUSHexample", 75));

		expect(ids).toHaveLength(75);
		expect(ids[0]).toBe(videoId(1));
		expect(ids[74]).toBe(videoId(75));
		expect(requests).toHaveLength(2);
		expect(query(requests[0]!).get("playlistId")).toBe("UUSHexample");
		expect(query(requests[0]!).get("pageToken")).toBeNull();
		expect(query(requests[1]!).get("pageToken")).toBe("page-2");
	});

	it("stops when there is no next page", async () => {
		respond = () => ({ status: 200, body: playlistPage(1, 3) });

		const ids = await Effect.runPromise(api.listPlaylistVideoIds("UUSHexample", 500));

		expect(ids).toEqual([videoId(1), videoId(2), videoId(3)]);
		expect(requests).toHaveLength(1);
	});

	it("batches video lookups by 50", async () => {
		respond = (input) => ({
			status: 200,
			body: { items: (query(input).get("id") ?? "").split(",").map((id) => video(id)) },
		});
		const ids = Array.from({ length: 120 }, (_, index) => videoId(index + 1));

		const videos = await Effect.runPromise(api.getVideos(ids));

		expect(requests.map((request) => query(request).get("id")?.split(",").length)).toEqual([
			50, 50, 20,
		]);
		expect(videos.map((item) => item.videoId)).toEqual(ids);
		expect(requests[0]?.action).toBe("videos.list");
	});

	it("asks for nothing when there are no ids", async () => {
		respond = () => ({ status: 200, body: { items: [] } });

		expect(await Effect.runPromise(api.getVideos([]))).toEqual([]);
		expect(requests).toHaveLength(0);
	});

	it("maps status and thumbnail fallbacks", async () => {
		respond = () => ({
			status: 200,
			body: {
				items: [
					video("aaaaaaaaaa1"),
					video("aaaaaaaaaa2", {
						snippet: {
							title: "Sample short two",
							channelTitle: "Example Channel",
							thumbnails: { default: { url: "https://example.com/2/default.jpg" } },
						},
						status: { privacyStatus: "unlisted", embeddable: false },
					}),
					video("aaaaaaaaaa3", {
						snippet: { title: "Sample short three", channelTitle: "Example Channel" },
					}),
				],
			},
		});

		const videos = await Effect.runPromise(
			api.getVideos(["aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3"]),
		);

		expect(videos).toEqual([
			{
				videoId: "aaaaaaaaaa1",
				title: "Sample short aaaaaaaaaa1",
				channelTitle: "Example Channel",
				thumbnail: "https://example.com/aaaaaaaaaa1/high.jpg",
				isPublic: true,
				embeddable: true,
			},
			{
				videoId: "aaaaaaaaaa2",
				title: "Sample short two",
				channelTitle: "Example Channel",
				thumbnail: "https://example.com/2/default.jpg",
				isPublic: false,
				embeddable: false,
			},
			{
				videoId: "aaaaaaaaaa3",
				title: "Sample short three",
				channelTitle: "Example Channel",
				thumbnail: null,
				isPublic: true,
				embeddable: true,
			},
		]);
	});

	it("fails with the status on a 403", async () => {
		respond = () => ({ status: 403, body: { error: { code: 403, message: "quotaExceeded" } } });

		const error = await Effect.runPromise(Effect.flip(api.listPlaylistVideoIds("UUSHexample", 10)));

		expect(error).toBeInstanceOf(YouTubeApiError);
		expect(error.status).toBe(403);
		expect(error.action).toBe("playlistItems.list");
	});

	it("fails when the response is not the expected shape", async () => {
		respond = () => ({ status: 200, body: { items: [{ unexpected: true }] } });

		const error = await Effect.runPromise(Effect.flip(api.listPlaylistVideoIds("UUSHexample", 10)));

		expect(error).toBeInstanceOf(YouTubeApiError);
		expect(error.action).toBe("playlistItems.list");
	});

	it("resolves a handle to its channel id", async () => {
		respond = () => ({ status: 200, body: { items: [{ id: "UCaaaaaaaaaaaaaaaaaaaaaa" }] } });

		const id = await Effect.runPromise(api.resolveChannelId("examplechannel"));

		expect(id).toEqual(Option.some("UCaaaaaaaaaaaaaaaaaaaaaa"));
		expect(query(requests[0]!).get("forHandle")).toBe("examplechannel");
		expect(requests[0]?.action).toBe("channels.list");
	});

	it("reports no channel when a handle matches none", async () => {
		respond = () => ({ status: 200, body: {} });

		const id = await Effect.runPromise(api.resolveChannelId("nobody"));

		expect(Option.isNone(id)).toBe(true);
	});
});
