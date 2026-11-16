import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { execute, parse } from "graphql";

import type { CmsCheckInPermission } from "@hccnj/strapi-v2";

// Module mocks must be before any imports that use them
void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	db: {
		collection: mock(() => ({
			doc: mock(() => ({ get: mock(), set: mock() })),
		})),
	},
	secondaryDb: {},
	dbFieldValue: {},
	fieldPath: {},
	FBPaths: {},
	getStorageBucket: mock(),
	AppCollections: { users: "app-users" },
	auth: { getUserByEmail: mock() },
}));

void mock.module("@/redis", () => ({
	redis: {
		get: mock(() => Promise.resolve(null)),
		set: mock(),
		mget: mock(),
		expire: mock(),
	},
}));

const runPromiseMock = mock(<Program>(_program?: Program) => Promise.resolve());

void mock.module("@/effect/Runtime", () => ({
	AppLayer: Layer.empty,
	managedRuntime: {
		runPromise: runPromiseMock,
	},
}));

// Import schema and context utils after mocks are set up
const { schema } = await import("@/graphql/schema");
const { AttendanceExportService } = await import("@/effect/services/AttendanceExportService");
const { CmsContent } = await import("@/effect/services/cms/content/CmsContent");
const { STATSIG_EVENT_ATTENDANCE_EXPORT_ALLOWLIST } =
	await import("@/graphql/schema/event/attendance");
const { createMockContext } = await import("../utils/test-context");

interface GraphQLTestResult<TData = NonNullable<Awaited<ReturnType<typeof execute>>["data"]>> {
	data: TData | null;
	errors?: readonly {
		extensions?: NonNullable<Awaited<ReturnType<typeof execute>>["extensions"]>;
		message: string;
	}[];
}

async function executeGraphQL<TData = NonNullable<Awaited<ReturnType<typeof execute>>["data"]>>(
	query: string,
	context: Parameters<typeof execute>[0]["contextValue"],
	variables?: NonNullable<Parameters<typeof execute>[0]["variableValues"]>,
): Promise<GraphQLTestResult<TData>> {
	const document = parse(query);
	const result = await execute({
		schema,
		document,
		contextValue: context,
		variableValues: variables,
	});
	return result as GraphQLTestResult<TData>;
}

const checkInPermissionsMock = mock(() =>
	Effect.succeed<readonly CmsCheckInPermission[] | null>([]),
);
const exportEventAttendancePdfMock = mock(() =>
	Effect.succeed({
		dataHash: "bulk-hash",
		exportKey: "bulk-export",
		format: "PDF",
		generated: true,
		lastGeneratedAt: new Date("2026-02-15T12:00:00.000Z"),
		url: "/v1/attendance-exports/bulk-export?token=bulk-token",
	}),
);
const exportEventAttendeesPdfMock = mock(() =>
	Effect.succeed({
		dataHash: "single-hash",
		exportKey: "single-export",
		format: "PDF",
		generated: true,
		lastGeneratedAt: new Date("2026-02-15T12:00:00.000Z"),
		url: "/v1/attendance-exports/single-export?token=single-token",
	}),
);

const RuntimeTestLayer = Layer.mergeAll(
	Layer.succeed(CmsContent, {
		checkInPermissions: Effect.suspend(() => checkInPermissionsMock()),
	} as never),
	Layer.succeed(AttendanceExportService, {
		exportEventAttendancePdf: exportEventAttendancePdfMock,
		exportEventAttendeesPdf: exportEventAttendeesPdfMock,
		getEventAttendanceByCcb: mock(() => Effect.succeed([])),
		getEventAttendeesSnapshot: mock(() =>
			Effect.succeed({
				attendees: [],
				attendeesCount: 0,
				ccbGroupId: "group-1",
				eventId: "event-1",
				eventName: "Event 1",
				occurrenceDate: "2026-02-15",
			}),
		),
	} as never),
);

function checkInPermission(eventCcbId: string, groupCcbId: string): CmsCheckInPermission {
	return { eventName: null, description: null, eventCcbId, groupCcbId, coordinatorEmails: [] };
}

function enableEffectBackedRuntime() {
	runPromiseMock.mockImplementation(
		<Program>(program: Program) =>
			Effect.runPromise(
				Effect.provide(
					program as Effect.Effect<unknown, unknown, never>,
					RuntimeTestLayer as never,
				),
			) as Promise<void>,
	);
}

function createEffectBackedContext(options: Parameters<typeof createMockContext>[0]) {
	return createMockContext({
		...options,
		effectRunPromise: <A, E, R>(program: Effect.Effect<A, E, R>) =>
			Effect.runPromise(
				Effect.provide(program as Effect.Effect<A, E, never>, RuntimeTestLayer as never),
			),
	});
}

beforeEach(() => {
	runPromiseMock.mockClear();
	runPromiseMock.mockImplementation(() => Promise.resolve());
	checkInPermissionsMock.mockClear();
	exportEventAttendancePdfMock.mockClear();
	exportEventAttendeesPdfMock.mockClear();
});

describe("exportEventAttendancePdf mutation", () => {
	const EXPORT_EVENT_ATTENDANCE_PDF_MUTATION = `
		mutation ExportEventAttendancePdf($input: [EventAttendanceExportEventInput!]!, $occurrenceDate: String!, $format: AttendanceExportFormat) {
			exportEventAttendancePdf(input: $input, occurrenceDate: $occurrenceDate, format: $format) {
				exportKey
				url
				format
				generated
			}
		}
	`;

	it("should deny signed-in users when Statsig allowedEmails is missing", async () => {
		const context = createEffectBackedContext({
			authType: "jwt",
			authorized: true,
			currentUserEmail: "allowed@example.com",
			currentUserUid: "test-user-uid-123",
			statsigEnabled: true,
		});

		const result = await executeGraphQL(EXPORT_EVENT_ATTENDANCE_PDF_MUTATION, context, {
			occurrenceDate: "2026-02-15",
			input: [
				{
					eventId: "event-1",
				},
			],
		});

		expect(result.errors?.some((error) => error.message.includes("not authorized"))).toBe(true);
		expect(runPromiseMock).not.toHaveBeenCalled();
	});

	it("should deny signed-in users when their email is not allowlisted", async () => {
		const context = createEffectBackedContext({
			authType: "jwt",
			authorized: true,
			currentUserEmail: "allowed@example.com",
			currentUserUid: "test-user-uid-123",
			dynamicConfigs: {
				[STATSIG_EVENT_ATTENDANCE_EXPORT_ALLOWLIST]: {
					allowedEmails: ["someoneelse@example.com"],
				},
			},
			statsigEnabled: true,
		});

		const result = await executeGraphQL(EXPORT_EVENT_ATTENDANCE_PDF_MUTATION, context, {
			occurrenceDate: "2026-02-15",
			input: [
				{
					eventId: "event-1",
				},
			],
		});

		expect(result.errors?.some((error) => error.message.includes("not authorized"))).toBe(true);
		expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
		expect(runPromiseMock).not.toHaveBeenCalled();
	});

	it("should deny signed-in users when any requested eventId is absent from Strapi", async () => {
		enableEffectBackedRuntime();
		checkInPermissionsMock.mockReturnValueOnce(
			Effect.succeed([checkInPermission("event-1", "group-1")]),
		);

		const context = createEffectBackedContext({
			authType: "jwt",
			authorized: true,
			currentUserEmail: " Allowed@Example.com ",
			currentUserUid: "test-user-uid-123",
			dynamicConfigs: {
				[STATSIG_EVENT_ATTENDANCE_EXPORT_ALLOWLIST]: {
					allowedEmails: ["allowed@example.com"],
				},
			},
			statsigEnabled: true,
		});

		const result = await executeGraphQL(EXPORT_EVENT_ATTENDANCE_PDF_MUTATION, context, {
			occurrenceDate: "2026-02-15",
			input: [
				{
					eventId: "event-1",
				},
				{
					eventId: "missing-event",
				},
			],
		});

		expect(result.errors?.some((error) => error.message.includes("not authorized"))).toBe(true);
		expect(checkInPermissionsMock).toHaveBeenCalledTimes(1);
		expect(exportEventAttendancePdfMock).not.toHaveBeenCalled();
		expect(exportEventAttendeesPdfMock).not.toHaveBeenCalled();
	});
});
