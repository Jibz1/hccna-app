import { AppConfig } from "@/effect/AppConfig";
import { testAppConfig } from "@/effect/services/__tests__/fixtures";
import { createMailServiceEffect, MailService } from "@/effect/services/MailService";
import { captureLogs } from "@/graphql/__tests__/utils/captureLogs";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

const message = {
	to: "ada@example.com",
	from: "noreply@example.com",
	subject: "Your code",
	text: "123456",
};

const sendLogged = async (send: () => Promise<never>) => {
	const logs = captureLogs();
	const layer = Layer.effect(
		MailService,
		createMailServiceEffect({ send, setApiKey: () => {} }),
	).pipe(Layer.provide(Layer.succeed(AppConfig, testAppConfig as never)), Layer.merge(logs.layer));
	await Effect.runPromise(
		Effect.gen(function* () {
			const mail = yield* MailService;
			return yield* mail.send(message);
		}).pipe(Effect.provide(layer), Effect.ignore),
	);
	return logs.lines;
};

describe("MailService", () => {
	it("logs a sent message without the recipient's address", async () => {
		const lines = await sendLogged(() => Promise.resolve([{ statusCode: 202 }, {}] as never));

		expect(lines).toContainEqual(expect.stringContaining("Mail sent"));
		expect(lines.join("\n")).not.toContain("ada@example.com");
	});

	it("logs a failed send without the recipient's address", async () => {
		const lines = await sendLogged(() => Promise.reject(new Error("SendGrid unavailable")));

		expect(lines).toContainEqual(expect.stringContaining("Mail send failed"));
		expect(lines.join("\n")).not.toContain("ada@example.com");
	});
});
