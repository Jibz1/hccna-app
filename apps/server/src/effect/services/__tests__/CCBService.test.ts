import { RedisService } from "@/effect/RedisService";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

import type { serviceRequest as serviceRequestFn } from "@/utils/serviceRequest";

process.env.CCB_USERNAME = "test_user";
process.env.CCB_PASSWORD = "test_password";
process.env.CCB_API_END_POINT = "https://test.ccbchurch.com/api.php";

const mockServiceRequest = mock((_input: Parameters<typeof serviceRequestFn>[0]) =>
	Promise.resolve({
		ok: true,
		status: 200,
		statusText: "OK",
		text: () =>
			Promise.resolve(`
			<ccb_api>
				<response>
					<individuals count="1">
						<individual id="123">
							<name>Test User</name>
							<email>test@example.com</email>
						</individual>
					</individuals>
				</response>
			</ccb_api>
		`),
	} as Response),
);

void mock.module("@/utils/serviceRequest", () => ({
	serviceRequest: mockServiceRequest,
}));

const { CCBService, CCBServiceLive } = await import("../CCBService");

const mockRedis = {
	// oxlint-disable-next-line no-null
	get: mock(() => Effect.succeed<string | null>(null)),
	mget: mock(() => Effect.succeed<(string | null)[]>([])),
	set: mock(() => Effect.void),
	setex: mock((_key: string, _seconds: number, _value: string) => Effect.void),
	incr: mock(() => Effect.succeed(1)),
	expire: mock(() => Effect.void),
	del: mock(() => Effect.void),
	keys: mock(() => Effect.succeed([] as string[])),
	ping: mock(() => Effect.succeed("PONG")),
};

const TestRedisLayer = Layer.succeed(RedisService, mockRedis as never);
const TestLayer = CCBServiceLive.pipe(Layer.provide(TestRedisLayer));

describe("CCBService", () => {
	it("should build correct URL for getGiving with year", async () => {
		mockServiceRequest.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			text: () =>
				Promise.resolve(`
				<ccb_api>
					<response>
						<transaction_detail_report></transaction_detail_report>
					</response>
				</ccb_api>
			`),
		} as Response);

		const program = Effect.gen(function* () {
			const ccb = yield* CCBService;
			return yield* ccb.getGiving("family123", 2024);
		});

		await Effect.runPromise(Effect.provide(program, TestLayer));

		const callArgs = mockServiceRequest.mock.calls[0]!;
		expect(callArgs[0].url).toContain("srv=transactions_by_family");
		expect(callArgs[0].url).toContain("family_id=family123");
		expect(callArgs[0].url).toContain("modified_since=2023-12-31");
		expect(callArgs[0].url).toContain("date_end=2024-12-31");
	});

	it("reads giving straight from CCB when the caller skips the cache", async () => {
		mockRedis.get.mockClear();
		mockRedis.setex.mockClear();
		mockServiceRequest.mockClear();
		mockServiceRequest.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			text: () =>
				Promise.resolve(`
				<ccb_api>
					<response>
						<transaction_detail_report></transaction_detail_report>
					</response>
				</ccb_api>
			`),
		} as Response);

		const program = Effect.gen(function* () {
			const ccb = yield* CCBService;
			return yield* ccb.getGiving("family123", 2024, { skipCache: true });
		});

		await Effect.runPromise(Effect.provide(program, TestLayer));

		expect(mockServiceRequest).toHaveBeenCalledTimes(1);
		expect(mockRedis.get).not.toHaveBeenCalled();
		expect(mockRedis.setex).not.toHaveBeenCalled();
	});

	it("names the CCB action when a GET fails", async () => {
		mockServiceRequest.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			text: () => Promise.resolve(""),
		} as Response);
		const logs = captureLogs();

		const program = Effect.gen(function* () {
			const ccb = yield* CCBService;
			return yield* ccb.getAttendanceProfile(42, "2026-10-04");
		});
		await Effect.runPromise(
			Effect.provide(program, Layer.merge(TestLayer, logs.layer)).pipe(Effect.ignore),
		);

		expect(logs.lines).toContainEqual(expect.stringContaining('"action":"attendance_profile"'));
	});
});
