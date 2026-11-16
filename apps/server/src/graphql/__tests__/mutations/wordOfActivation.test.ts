import { describe, expect, it, mock } from "bun:test";
import { execute, parse, validate } from "graphql";

// Module mocks must be before any imports that use them
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

const isAuthError = async (mutation: string, contextValue: ReturnType<typeof anonymous>) => {
	const result = await execute({ schema, document: parse(mutation), contextValue });
	return result.errors?.some((error) => error.message.includes("Not authorized")) ?? false;
};

describe.each([
	[
		"wordOfActivationMonthly",
		"mutation WordOfActivationMonthly { wordOfActivationMonthly { __typename } }",
	],
	[
		"wordOfActivationSendPending",
		"mutation WordOfActivationSendPending { wordOfActivationSendPending { __typename } }",
	],
])("%s mutation", (_field, mutation) => {
	it("denies anonymous callers", async () => {
		expect(await isAuthError(mutation, anonymous())).toBe(true);
	});

	it("denies signed-in members", async () => {
		expect(await isAuthError(mutation, signedIn())).toBe(true);
	});
});

describe("wordOfActivationMonthly compatibility", () => {
	it("still validates the query Cloud Scheduler sends", () => {
		// WordActivationCron's request body as deployed on 2026-10-01.
		const schedulerQuery = `mutation WordOfActivationMonthly {
			wordOfActivationMonthly {
				__typename
				... on WordOfActivationMonthlySuccess { message assigned emailed skipped failed }
				... on WordOfActivationRotationError { message }
			}
		}`;

		expect(validate(schema, parse(schedulerQuery))).toEqual([]);
	});
});
