import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { execute, parse } from "graphql";

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

void mock.module("@/effect/Runtime", () => ({
	AppLayer: Layer.empty,
	managedRuntime: { runPromise: mock(() => Promise.resolve(null)) },
}));

const { schema } = await import("@/graphql/schema");
const { CCBService } = await import("@/effect/services/CCBService");
const { CmsContent } = await import("@/effect/services/cms/content/CmsContent");
const { createMockContext } = await import("../utils/test-context");

const OWN_EVENT = { eventCcbId: "1001", groupCcbId: "2001" };
const OTHER_EVENT = { eventCcbId: "1002", groupCcbId: "2002" };
const COORDINATOR_EMAIL = "ada@example.com";

const checkInPermissions = [
	{
		eventName: "Toddlers",
		description: "",
		...OWN_EVENT,
		coordinatorEmails: [COORDINATOR_EMAIL],
	},
	{
		eventName: "Juniors",
		description: "",
		...OTHER_EVENT,
		coordinatorEmails: ["grace@example.com"],
	},
];

const createEventAttendance = mock(() => Effect.succeed({}));
const getAttendanceProfile = mock((_eventId: number, _occurrence: string) =>
	Effect.succeed({
		events: {
			event: { notes: "Synthetic notes", topic: "Synthetic topic", attendees: { attendee: [] } },
		},
	}),
);
const getGroupParticipants = mock((groupId: number) =>
	Effect.succeed({
		groups: {
			count: "1",
			group: { id: String(groupId), name: "Toddlers", participants: { participant: [] } },
		},
	}),
);

// The resolvers read coordinator permissions from the CMS and attendance from CCB only.
const services = Layer.mergeAll(
	Layer.succeed(CmsContent, { checkInPermissions: Effect.succeed(checkInPermissions) } as never),
	Layer.succeed(CCBService, {
		createEventAttendance,
		getAttendanceProfile,
		getGroupParticipants,
	} as never),
);

const coordinator = () =>
	createMockContext({
		currentUserUid: "coordinator-uid",
		currentUserEmail: COORDINATOR_EMAIL,
		authorized: true,
		authType: "jwt",
		effectRunPromise: (program) =>
			Effect.runPromise(program.pipe(Effect.provide(services)) as never),
	});

type Variables = NonNullable<Parameters<typeof execute>[0]["variableValues"]>;

async function run<TData>(query: string, variables: Variables) {
	const result = await execute({
		schema,
		document: parse(query),
		contextValue: coordinator(),
		variableValues: variables,
	});
	return result as { data: TData | null; errors?: readonly { message: string }[] };
}

beforeEach(() => {
	createEventAttendance.mockClear();
	getAttendanceProfile.mockClear();
	getGroupParticipants.mockClear();
});

describe("createEventAttendance", () => {
	const MUTATION = `
		mutation SaveAttendance($input: UpdateEventAttendanceInput!) {
			createEventAttendance(input: $input) { success message }
		}
	`;
	const input = (eventId: string) => ({
		input: { eventId, attendeesIds: ["3001"], notes: "", topic: "" },
	});

	it("records attendance for an event the caller coordinates", async () => {
		const result = await run<{ createEventAttendance: { success: boolean } }>(
			MUTATION,
			input(OWN_EVENT.eventCcbId),
		);

		expect(result.data?.createEventAttendance.success).toBe(true);
		expect(createEventAttendance).toHaveBeenCalledTimes(1);
	});

	it("refuses an event that belongs to another coordinator", async () => {
		const result = await run<{ createEventAttendance: { success: boolean } }>(
			MUTATION,
			input(OTHER_EVENT.eventCcbId),
		);

		expect(result.data?.createEventAttendance.success).toBe(false);
		expect(createEventAttendance).not.toHaveBeenCalled();
	});
});

describe("eventWithAttendance", () => {
	const QUERY = `
		query CheckIn($ccbGroupId: String!, $eventID: String!) {
			eventWithAttendance(ccbGroupId: $ccbGroupId, eventID: $eventID) {
				ccbEventId
				attendanceRecord { notes topic }
			}
		}
	`;

	it("returns the record for the caller's own event and group", async () => {
		const result = await run<{ eventWithAttendance: { ccbEventId: string } | null }>(QUERY, {
			ccbGroupId: OWN_EVENT.groupCcbId,
			eventID: OWN_EVENT.eventCcbId,
		});

		expect(result.data?.eventWithAttendance?.ccbEventId).toBe(OWN_EVENT.eventCcbId);
	});

	it("does not read another coordinator's event through the caller's own group", async () => {
		const result = await run<{ eventWithAttendance: unknown }>(QUERY, {
			ccbGroupId: OWN_EVENT.groupCcbId,
			eventID: OTHER_EVENT.eventCcbId,
		});

		expect(result.data?.eventWithAttendance).toBeNull();
		expect(getAttendanceProfile).not.toHaveBeenCalled();
	});
});
