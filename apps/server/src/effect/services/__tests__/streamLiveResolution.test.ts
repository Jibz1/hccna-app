import { resolveStreamLiveState } from "@/effect/services/StreamMappingService";
import { describe, expect, it } from "bun:test";
import { Timestamp } from "firebase-admin/firestore";

import type { Doc } from "@/utils/castr/index";

// An offline-expired resolution makes the poll switch the stream's Castr
// destinations off, so ending a stream early cuts a live service (#129).

const MINUTE = 60_000;
const now = Date.parse("2026-11-07T03:20:00Z");

const castrStream = (
	enabled: boolean,
	destinations: readonly { enabled: boolean; online: boolean }[],
): Doc => ({
	_id: "stream-1",
	name: "Example Campus",
	enabled,
	ingest: { server: "rtmp://ingest.example.com", key: "ingest-key" },
	playback: { embed_url: "https://player.example.com/1", hls_url: undefined },
	platforms: destinations.map((destination, index) => ({
		_id: `platform-${index}`,
		name: `Destination ${index}`,
		enabled: destination.enabled,
		template: "custom",
		server: "rtmp://destination.example.com",
		key: `key-${index}`,
		broadcasting_status: destination.online ? "online" : "offline",
	})),
	settings: {
		abr: false,
		country_block: [],
		country_whitelist: [],
		domain_whitelist: [],
		embed_password: false,
		chat_enabled: false,
	},
	broadcasting_status: "offline",
	user: "user-1",
	creation_time: new Date("2026-01-01T00:00:00Z"),
});

const resolve = (stream: Doc, offlineMinutesAgo?: number) =>
	resolveStreamLiveState({
		stream,
		previousIsLive: true,
		offlineObservedAt:
			offlineMinutesAgo === undefined
				? undefined
				: Timestamp.fromMillis(now - offlineMinutesAgo * MINUTE),
		isEndingStream: false,
		now,
	});

describe("resolveStreamLiveState", () => {
	const droppedEncoder = castrStream(true, [{ enabled: true, online: false }]);

	it("keeps a live stream whose encoder dropped live until a second offline reading", () => {
		expect(resolve(droppedEncoder)).toMatchObject({
			isLive: true,
			event: "offline-observed",
		});
		expect(resolve(droppedEncoder, 5).isLive).toBe(true);
	});

	it("ends a dropped stream on the next 10-minute poll even when that poll runs early", () => {
		expect(resolve(droppedEncoder, 9.7)).toMatchObject({
			isLive: false,
			event: "offline-expired",
		});
	});

	it("ends a stream at once when Castr has every destination or the stream switched off", () => {
		const destinationsOff = castrStream(true, [
			{ enabled: false, online: false },
			{ enabled: false, online: false },
		]);
		const streamOff = castrStream(false, [{ enabled: true, online: false }]);
		for (const stream of [destinationsOff, streamOff]) {
			expect(resolve(stream)).toMatchObject({
				isLive: false,
				event: "castr-disabled",
			});
		}
	});

	it("keeps a stream live while any destination is still broadcasting", () => {
		const oneOnline = castrStream(true, [
			{ enabled: false, online: false },
			{ enabled: true, online: true },
		]);
		expect(resolve(oneOnline, 30).isLive).toBe(true);
	});
});
