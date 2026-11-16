import { describe, expect, it, mock } from "bun:test";
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

// Import schema and context utils after mocks are set up
const { schema } = await import("@/graphql/schema");
const { anonymous, signedIn } = await import("../utils/test-context");

interface GraphQLTestResult<TData = NonNullable<Awaited<ReturnType<typeof execute>>["data"]>> {
	data: TData | null;
	errors?: readonly { message: string }[];
}

async function executeGraphQL<TData = NonNullable<Awaited<ReturnType<typeof execute>>["data"]>>(
	query: string,
	context: Parameters<typeof execute>[0]["contextValue"],
): Promise<GraphQLTestResult<TData>> {
	const document = parse(query);
	const result = await execute({
		schema,
		document,
		contextValue: context,
	});
	return result as GraphQLTestResult<TData>;
}

function isAuthError(result: GraphQLTestResult): boolean {
	return (
		result.errors?.some(
			(e) => e.message.includes("Not authorized") || e.message.includes("unauthorized"),
		) ?? false
	);
}

describe("vodPushNotification mutation", () => {
	const VOD_PUSH_MUTATION = `
		mutation VodPushNotification {
			vodPushNotification {
				__typename
				... on VodSuccess {
					message
				}
				... on VodFetchError {
					message
				}
				... on VodNotFoundError {
					message
				}
				... on VodPushNotificationError {
					message
				}
			}
		}
	`;

	it("should deny access when not googleInternal", async () => {
		const context = anonymous();
		const result = await executeGraphQL(VOD_PUSH_MUTATION, context);

		expect(isAuthError(result)).toBe(true);
	});

	it("should deny access when signedIn (not googleInternal)", async () => {
		const context = signedIn();
		const result = await executeGraphQL(VOD_PUSH_MUTATION, context);

		expect(isAuthError(result)).toBe(true);
	});
});
