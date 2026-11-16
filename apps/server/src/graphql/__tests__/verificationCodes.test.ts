import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { MailService } from "@/effect/services/MailService";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { sentry } from "@/graphql/__tests__/utils/sentry-mocks";
import { createMockContext } from "@/graphql/__tests__/utils/test-context";
import { schema } from "@/graphql/schema";
import {
	generateAuthSignInCodeAndSendEmailEffect,
	verifyCodeEffect,
} from "@/graphql/schema/user/user";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { execute, parse } from "graphql";

interface CodeDocument {
	code?: string;
	expiresAt?: number | undefined;
	failedAttempts?: number;
	lockedUntil?: number;
}
interface Transaction {
	get: (reference: string) => Promise<{ exists: boolean; data: () => CodeDocument | undefined }>;
	update: (reference: string, data: Partial<CodeDocument>) => void;
	set: (reference: string, data: CodeDocument) => void;
	delete: (reference: string) => void;
}

function makeHarness(initial: CodeDocument | undefined, logs: Layer.Layer<never> = Layer.empty) {
	let value: CodeDocument | undefined = initial;
	let queue = Promise.resolve();
	const attempts: number[] = [];
	const send = mock(() => Effect.succeed([{}, {}]));
	const runTransaction = <A>(run: (transaction: Transaction) => Promise<A>) => {
		const result = queue.then(async () => {
			let pending = value;
			const outcome = await run({
				get: () => Promise.resolve({ exists: pending !== undefined, data: () => pending }),
				update: (_reference, data) => {
					pending = pending ? { ...pending, ...data } : undefined;
					if (data.failedAttempts !== undefined) {
						attempts.push(data.failedAttempts);
					}
				},
				set: (_reference, data) => {
					pending = data;
				},
				delete: () => {
					pending = undefined;
				},
			});
			value = pending;
			return outcome;
		});
		queue = result.then(
			() => {},
			() => {},
		);
		return result;
	};
	const layer = Layer.mergeAll(
		// The verifier uses only collection/doc references and Firestore transactions.
		Layer.succeed(FirebaseAdminService, {
			db: { collection: (name: string) => ({ doc: () => name }), runTransaction },
			collections: { signInCode: "sign-in-code", deleteAccountCode: "delete-account-code" },
		} as never),
		// Only the send method is used by post-commit security notifications.
		Layer.succeed(MailService, { send } as never),
		logs,
	);
	const verify = (code: string, collection = "sign-in-code") =>
		Effect.runPromise(
			verifyCodeEffect({ code, email: "member@example.com", collection }).pipe(
				Effect.provide(layer),
				Effect.result,
			),
		);
	const issue = () =>
		Effect.runPromise(
			generateAuthSignInCodeAndSendEmailEffect({
				email: "member@example.com",
				codeType: "auth",
			}).pipe(Effect.provide(layer), Effect.result),
		);
	return { verify, issue, attempts, send, layer, getValue: () => value };
}

describe("verification code transactions", () => {
	it.each(["sign-in-code", "delete-account-code"])(
		"consumes a valid %s code only once under concurrent requests",
		async (collection) => {
			const harness = makeHarness({ code: "123456", expiresAt: Date.now() + 60_000 });
			const outcomes = await Promise.all(
				Array.from({ length: 10 }, () => harness.verify("123456", collection)),
			);
			expect(outcomes.filter((result) => result._tag === "Success")).toHaveLength(1);
			expect(outcomes.filter((result) => result._tag === "Failure")).toHaveLength(9);
			expect(harness.getValue()).toBeUndefined();
			expect(harness.send).not.toHaveBeenCalled();
		},
	);

	it("counts concurrent failures without lost updates and sends one post-commit alert", async () => {
		const harness = makeHarness({ code: "123456", expiresAt: Date.now() + 60_000 });
		const outcomes = await Promise.all(Array.from({ length: 12 }, () => harness.verify("000000")));
		expect(outcomes.every((result) => result._tag === "Failure")).toBe(true);
		// The fifth failure writes the lock instead of a count.
		expect(harness.attempts).toEqual([1, 2, 3, 4]);
		expect(harness.send).toHaveBeenCalledTimes(1);
		expect((await harness.verify("123456"))._tag).toBe("Failure");
	});

	it.each([undefined, 0, Number.NaN, Number.POSITIVE_INFINITY])(
		"fails closed with invalid expiry %s",
		async (expiresAt) => {
			const harness = makeHarness({ code: "123456", expiresAt });
			const result = await harness.verify("123456");
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				expect(result.failure._tag).toBe("CodeExpiredError");
			}
			expect(harness.getValue()).toBeUndefined();
		},
	);

	it("does not admit a correct request queued after the final allowed failure", async () => {
		const harness = makeHarness({
			code: "123456",
			expiresAt: Date.now() + 60_000,
			failedAttempts: 4,
		});
		const outcomes = await Promise.all([harness.verify("wrong"), harness.verify("123456")]);
		expect(outcomes.every((result) => result._tag === "Failure")).toBe(true);
		expect(harness.send).toHaveBeenCalledTimes(1);
	});

	it("logs a failed lockout alert without the member's email", async () => {
		const logs = captureLogs();
		const harness = makeHarness(
			{ code: "123456", expiresAt: Date.now() + 60_000, failedAttempts: 5 },
			logs.layer,
		);
		harness.send.mockImplementation(
			() =>
				Effect.fail({ _tag: "MailSendError", cause: new Error("SendGrid unavailable") }) as never,
		);

		const result = await harness.verify("000000");

		expect(result._tag).toBe("Failure");
		expect(logs.lines).toContainEqual(
			expect.stringContaining("Failed to send security alert email"),
		);
		expect(logs.lines.join("\n")).not.toContain("member@example.com");
	});

	it("locks the address after the last allowed failure instead of forgetting the failures", async () => {
		const harness = makeHarness({
			code: "123456",
			expiresAt: Date.now() + 60_000,
			failedAttempts: 5,
		});

		const locked = await harness.verify("000000");

		expect(locked._tag === "Failure" && locked.failure._tag).toBe("MaxAttemptsError");
		expect(harness.getValue()?.lockedUntil).toBeGreaterThan(Date.now());
		expect(harness.getValue()?.code).toBeUndefined();
	});

	it("locks the address on the fifth wrong code, before the code can expire unlocked", async () => {
		const harness = makeHarness({
			code: "123456",
			expiresAt: Date.now() + 60_000,
			failedAttempts: 4,
		});

		const fifth = await harness.verify("000000");

		expect(fifth._tag === "Failure" && fifth.failure._tag).toBe("MaxAttemptsError");
		expect(harness.getValue()?.lockedUntil).toBeGreaterThan(Date.now());
		expect(harness.getValue()?.code).toBeUndefined();
		expect(harness.send).toHaveBeenCalledTimes(1);
	});

	it("does not send a replacement for a code whose attempts are already spent", async () => {
		const harness = makeHarness({
			code: "123456",
			expiresAt: Date.now() + 60_000,
			failedAttempts: 5,
		});

		const result = await harness.issue();

		expect(result._tag === "Failure" && result.failure._tag).toBe("MaxAttemptsError");
		expect(harness.send).not.toHaveBeenCalled();
		expect(harness.getValue()?.lockedUntil).toBeGreaterThan(Date.now());
	});

	it("refuses to issue a new code while the address is locked", async () => {
		const harness = makeHarness({ lockedUntil: Date.now() + 60_000 });

		const result = await harness.issue();

		expect(result._tag === "Failure" && result.failure._tag).toBe("MaxAttemptsError");
		expect(harness.send).not.toHaveBeenCalled();
		expect(harness.getValue()?.code).toBeUndefined();
	});

	it("alerts the member when the lock starts, not on each attempt during it", async () => {
		const harness = makeHarness({ lockedUntil: Date.now() + 60_000 });

		const result = await harness.verify("123456");

		expect(result._tag === "Failure" && result.failure._tag).toBe("MaxAttemptsError");
		expect(harness.send).not.toHaveBeenCalled();
	});

	it("keeps the failures already counted when a code is re-issued before it expires", async () => {
		const harness = makeHarness({
			code: "123456",
			expiresAt: Date.now() + 60_000,
			failedAttempts: 4,
		});

		const result = await harness.issue();

		expect(result._tag).toBe("Success");
		expect(harness.getValue()?.failedAttempts).toBe(4);
		expect(harness.getValue()?.code).not.toBe("123456");
	});

	it.each([
		["the previous code expired", { code: "123456", expiresAt: Date.now() - 1, failedAttempts: 4 }],
		["an earlier lock has ended", { lockedUntil: Date.now() - 1 }],
		["no code was issued before", undefined],
	])("issues a code with a full attempt budget when %s", async (_case, initial) => {
		const harness = makeHarness(initial);

		const result = await harness.issue();

		expect(result._tag).toBe("Success");
		expect(harness.getValue()).toMatchObject({ failedAttempts: 0 });
		expect(harness.getValue()?.lockedUntil).toBeUndefined();
		expect(harness.send).toHaveBeenCalledTimes(1);
	});
});

describe("createSignInCode while the address is locked", () => {
	beforeEach(() => {
		sentry.captureException.mockClear();
	});

	it("answers with the lock message and does not report it as a server failure", async () => {
		const harness = makeHarness({ lockedUntil: Date.now() + 60_000 });
		const result = await execute({
			schema,
			document: parse(`
				mutation CreateSignInCode($email: String!) {
					createSignInCode(email: $email) { success message }
				}
			`),
			variableValues: { email: "member@example.com" },
			contextValue: createMockContext({
				authorized: true,
				authType: "token",
				effectRunPromise: (program) =>
					Effect.runPromise(program.pipe(Effect.provide(harness.layer)) as never),
			}),
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.createSignInCode).toEqual({
			success: false,
			message: "Too many failed attempts. Please try again later.",
		});
		expect(sentry.captureException).not.toHaveBeenCalled();
	});
});
