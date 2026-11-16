import { describe, expect, it, mock } from "bun:test";
import { Effect } from "effect";

import { createCCBClient } from "../src";

const createMockResponse = ({
	ok = true,
	status = 200,
	statusText = "OK",
	body = "",
}: {
	ok?: boolean;
	status?: number;
	statusText?: string;
	body?: string;
}) =>
	new Response(body, {
		status: ok ? status : Math.max(status, 400),
		statusText,
	});

const dummyConfig = {
	apiEndpoint: "https://test.ccb.io/api",
	username: "test-user",
	password: "test-password",
};

describe("CCBClient retry logic", () => {
	it("does NOT retry fetchPost (non-idempotent)", async () => {
		let callCount = 0;
		const httpFetch = mock(() => {
			callCount++;
			return Promise.resolve(
				createMockResponse({
					ok: false,
					status: 500,
					statusText: "Internal Server Error",
				}),
			);
		});

		const client = createCCBClient(dummyConfig, httpFetch);

		const result = await Effect.runPromise(
			Effect.result(
				client.createEventAttendance({
					eventId: 1,
					occurrence: "2024-01-01",
					attendeeIds: [1, 2],
					topic: "Test",
					notes: "Test",
				}),
			),
		);

		// fetchPost should NOT retry — only 1 attempt
		expect(callCount).toBe(1);
		expect(result._tag).toBe("Failure");
	});
});
