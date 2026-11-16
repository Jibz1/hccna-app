import { describe, expect, it } from "bun:test";

import { parseChannelRef, shortsPlaylistId } from "../channelRef";

describe("parseChannelRef", () => {
	it.each([
		["UCaaaaaaaaaaaaaaaaaaaaaa", { kind: "id", id: "UCaaaaaaaaaaaaaaaaaaaaaa" }],
		[
			"https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa",
			{ kind: "id", id: "UCaaaaaaaaaaaaaaaaaaaaaa" },
		],
		["@examplechannel", { kind: "handle", handle: "examplechannel" }],
		[
			"https://www.youtube.com/@examplechannel/shorts",
			{ kind: "handle", handle: "examplechannel" },
		],
		["  youtube.com/@Example.Channel-1  ", { kind: "handle", handle: "Example.Channel-1" }],
		["https://m.youtube.com/@examplechannel?si=abc", { kind: "handle", handle: "examplechannel" }],
	] as const)("parses %s", (input, expected) => {
		expect(parseChannelRef(input)).toEqual(expected);
	});

	it.each([
		"",
		"examplechannel",
		"https://www.youtube.com/shorts/aaaaaaaaaa1",
		"UCshort",
		"UCaaaaaaaaaaaaaaaaaaaaaaTOOLONG",
		"https://example.com/@x",
		"https://notyoutube.com/@examplechannel",
	])("rejects %s", (input) => {
		expect(parseChannelRef(input)).toBeNull();
	});
});

describe("shortsPlaylistId", () => {
	it("swaps the UC prefix for UUSH", () => {
		expect(shortsPlaylistId("UCaaaaaaaaaaaaaaaaaaaaaa")).toBe("UUSHaaaaaaaaaaaaaaaaaaaaaa");
	});
});
