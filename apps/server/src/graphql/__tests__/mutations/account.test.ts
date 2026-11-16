import { describe, expect, it, mock } from "bun:test";
import { Layer } from "effect";
import { execute, parse } from "graphql";

// Module mocks must be before any imports that use them
void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	db: {
		collection: mock(() => ({
			doc: mock(() => ({
				get: mock(() =>
					Promise.resolve({
						exists: true,
						data: () => ({
							email: "test@example.com",
						}),
					}),
				),
				set: mock(() => Promise.resolve()),
				delete: mock(() => Promise.resolve()),
			})),
			where: mock(() => ({
				get: mock(() => Promise.resolve({ docs: [] })),
			})),
		})),
	},
	secondaryDb: {},
	dbFieldValue: {
		serverTimestamp: mock(() => new Date()),
	},
	fieldPath: {},
	FBPaths: {},
	getStorageBucket: mock(),
	AppCollections: {
		users: "app-users",
		signInCode: "sign-in-codes",
		deleteAccountCode: "delete-sign-in-codes",
	},
	auth: {
		getUserByEmail: mock(() => Promise.resolve({ uid: "test-uid" })),
		deleteUser: mock(() => Promise.resolve()),
	},
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
		runPromise: mock(() => Promise.resolve()),
	},
}));

// Mock sendgrid
void mock.module("@sendgrid/mail", () => ({
	default: {
		setApiKey: mock(),
		send: mock(() => Promise.resolve()),
	},
}));

// Import schema and context utils after mocks are set up
const { schema } = await import("@/graphql/schema");
const { anonymous, signedIn, authorized } = await import("../utils/test-context");

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

function isAuthError(result: GraphQLTestResult): boolean {
	return (
		result.errors?.some(
			(e) => e.message.includes("Not authorized") || e.message.includes("unauthorized"),
		) ?? false
	);
}

describe("postDeletionCleanup mutation", () => {
	const POST_DELETION_CLEANUP_MUTATION = `
		mutation PostDeletionCleanup($uid: String!, $email: String!) {
			postDeletionCleanup(uid: $uid, email: $email) {
				success
				message
			}
		}
	`;

	const variables = {
		uid: "test-uid-123",
		email: "test@example.com",
	};

	it("should deny access when not authenticated", async () => {
		const context = anonymous();
		const result = await executeGraphQL(POST_DELETION_CLEANUP_MUTATION, context, variables);

		expect(isAuthError(result)).toBe(true);
	});

	it("should deny access when only signedIn (not googleInternal)", async () => {
		const context = signedIn();
		const result = await executeGraphQL(POST_DELETION_CLEANUP_MUTATION, context, variables);

		expect(isAuthError(result)).toBe(true);
	});

	it("should deny access when only authorized (not googleInternal)", async () => {
		const context = authorized();
		const result = await executeGraphQL(POST_DELETION_CLEANUP_MUTATION, context, variables);

		expect(isAuthError(result)).toBe(true);
	});
});
