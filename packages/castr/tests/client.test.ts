import { describe, expect, it } from "bun:test";
import { Effect } from "effect";

import { createCastrClient } from "../src";

const config = {
	apiEndpoint: "https://castr.example.com",
	username: "example-user",
	password: "example-password",
};

describe("CastrClient.patchPlatform", () => {
	it("keeps Castr's status and response body when it rejects a destination update", async () => {
		const client = createCastrClient(config, () =>
			Promise.resolve(
				new Response('{\n  "message": "Example upstream failure"\n}', {
					status: 500,
					statusText: "Internal Server Error",
				}),
			),
		);

		const error = await Effect.runPromise(
			Effect.flip(
				client.patchPlatform({
					streamId: "stream-123",
					platformId: "platform-1",
					data: { enabled: false },
				}),
			),
		);

		const { _tag, message, status, body } = error;
		expect({ _tag, message, status, body }).toEqual({
			_tag: "CastrPatchError",
			// Retry and reconciliation code match on this exact message shape.
			message: "Castr API error: 500 Internal Server Error",
			status: 500,
			body: '{ "message": "Example upstream failure" }',
		});
	});

	it("reads only the start of a large error body", async () => {
		const chunk = new TextEncoder().encode("x".repeat(1024));
		const totalChunks = 1024; // 1 MiB on offer
		let pulledBytes = 0;
		let sentChunks = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sentChunks === totalChunks) {
					controller.close();
					return;
				}
				sentChunks += 1;
				pulledBytes += chunk.byteLength;
				controller.enqueue(chunk);
			},
		});
		const client = createCastrClient(config, () =>
			Promise.resolve(
				new Response(body, { status: 500, statusText: "Internal Server Error" }),
			),
		);

		const error = await Effect.runPromise(
			Effect.flip(
				client.patchPlatform({
					streamId: "stream-123",
					platformId: "platform-1",
					data: { enabled: false },
				}),
			),
		);

		expect(error.body).toBe("x".repeat(200));
		expect(pulledBytes).toBeLessThan(64 * 1024);
	});
});
