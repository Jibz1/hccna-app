import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";
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
							deviceTokens: ["token-1", "token-2"],
						}),
					}),
				),
				set: mock(() => Promise.resolve()),
				update: mock(() => Promise.resolve()),
			})),
			where: mock(() => ({
				get: mock(() =>
					Promise.resolve({
						docs: [
							{
								data: () => ({
									deviceTokens: ["token-1"],
								}),
							},
						],
					}),
				),
			})),
		})),
	},
	secondaryDb: {},
	dbFieldValue: {
		arrayUnion: mock(<Input>(val: Input) => val),
		serverTimestamp: mock(() => new Date()),
	},
	fieldPath: {},
	FBPaths: {},
	getStorageBucket: mock(),
	AppCollections: { users: "app-users" },
	auth: { getUserByEmail: mock() },
}));

// Mock firebase-admin/messaging
void mock.module("firebase-admin/messaging", () => ({
	getMessaging: mock(() => ({
		send: mock(() => Promise.resolve("message-id")),
		sendEachForMulticast: mock(() =>
			Promise.resolve({
				successCount: 1,
				failureCount: 0,
				responses: [],
			}),
		),
	})),
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
		runPromise: mock(() => Promise.resolve({ success: true })),
	},
}));

// Import schema and context utils after mocks are set up
const { schema } = await import("@/graphql/schema");
const { FirebaseAdminService } = await import("@/effect/services/FirebaseAdminService");
const { anonymous, authorized, createMockContext, signedIn } =
	await import("../utils/test-context");

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

describe("sendAnnouncement mutation", () => {
	const SEND_ANNOUNCEMENT_MUTATION = `
		mutation SendAnnouncement($input: SendAnnouncementInput!) {
			sendAnnouncement(input: $input) {
				success
				message
			}
		}
	`;

	const validInput = {
		input: {
			title: "Church Announcement",
			subtitle: "Important Update",
			message: "Join us for the special service this Sunday!",
		},
	};

	it("should deny access when not authenticated", async () => {
		const context = anonymous();
		const result = await executeGraphQL(SEND_ANNOUNCEMENT_MUTATION, context, validInput);

		expect(isAuthError(result)).toBe(true);
	});

	it.each([
		["the shared client token", () => authorized()],
		["a signed-in member", () => signedIn()],
	])("should deny %s, which every app install can present", async (_caller, context) => {
		const result = await executeGraphQL(SEND_ANNOUNCEMENT_MUTATION, context(), validInput);

		expect(isAuthError(result)).toBe(true);
	});

	it("should publish for an allowlisted internal caller", async () => {
		const sendMessage = mock(() => Effect.succeed("message-id"));
		const context = createMockContext({
			authorized: true,
			authType: "googleInternal",
			effectRunPromise: (program) =>
				Effect.runPromise(
					program.pipe(
						// The resolver only publishes one topic message.
						Effect.provide(Layer.succeed(FirebaseAdminService, { sendMessage } as never)),
					) as never,
				),
		});

		const result = await executeGraphQL<{ sendAnnouncement: { success: boolean } }>(
			SEND_ANNOUNCEMENT_MUTATION,
			context,
			validInput,
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.sendAnnouncement.success).toBe(true);
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
});
