import { describe, expect, it, mock } from "bun:test";
import { Layer } from "effect";
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
	managedRuntime: {
		runPromise: mock(() =>
			Promise.resolve({
				cachedResult: { groups: { count: "0" }, participant: [] },
				uncachedResult: null,
			}),
		),
	},
}));

// Import schema and context utils after mocks are set up
const { schema } = await import("@/graphql/schema");
const { signedIn } = await import("../utils/test-context");

interface GraphQLTestResult<TData = NonNullable<Awaited<ReturnType<typeof execute>>["data"]>> {
	data: TData | null;
	errors?: readonly { message: string }[];
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

describe("eventAttendanceByCcb query", () => {
	const EVENT_ATTENDANCE_BY_CCB_QUERY = `
		query EventAttendanceByCcb($input: [EventAttendanceLookupInput!]!) {
			eventAttendanceByCcb(input: $input) {
				eventId
				ccbId
				attended
			}
		}
	`;

	it("should enforce bulk limit for signed-in users", async () => {
		const context = signedIn();
		const input = Array.from({ length: 51 }, (_, index) => ({
			ccbId: `${index + 1}`,
			eventId: "event-1",
			occurrenceDate: "2026-02-15",
		}));

		const result = await executeGraphQL(EVENT_ATTENDANCE_BY_CCB_QUERY, context, {
			input,
		});

		expect(
			result.errors?.some((error) => error.message.includes("Bulk lookup limit exceeded")),
		).toBe(true);
	});
});
