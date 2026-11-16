import { AppConfig } from "@/effect/AppConfig";
import sgMail from "@sendgrid/mail";
import { Context, Effect, Layer, Schema } from "effect";

// @sendgrid/mail's declaration file mixes `export =` with named exports; TypeScript 7
// only honors the `export =`, so these types are derived from the default export.
export type MailDataRequired = Exclude<Parameters<typeof sgMail.send>[0], readonly unknown[]>;
type ClientResponse = Awaited<ReturnType<typeof sgMail.send>>[0];

class MailSendError extends Schema.TaggedError<MailSendError>()("MailSendError", {
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `Mail: ${this.detail}`;
	}
}

interface SendGridClient {
	send: (data: MailDataRequired) => Promise<[ClientResponse, unknown]>;
	setApiKey: (apiKey: string) => void;
}

interface MailServiceContract {
	send: (data: MailDataRequired) => Effect.Effect<[ClientResponse, unknown], MailSendError>;
}

export function createMailServiceEffect(client: SendGridClient = sgMail) {
	return Effect.gen(function* () {
		const appConfig = yield* AppConfig;
		const apiKey = appConfig.integrations.sendgridApiKey;

		if (apiKey) {
			client.setApiKey(apiKey);
		}

		return {
			send: Effect.fn("MailService.send")(function* (data: MailDataRequired) {
				return yield* Effect.tryPromise({
					try: () => client.send(data),
					catch: (cause) =>
						new MailSendError({
							detail: "Failed to send email",
							cause,
						}),
				}).pipe(
					// Recipients are addresses of real people; they stay out of logs.
					Effect.tap(() => Effect.logInfo("Mail sent")),
					Effect.tapError((error) =>
						Effect.logError("Mail send failed").pipe(Effect.annotateLogs({ error: error.message })),
					),
				);
			}),
		} satisfies MailServiceContract;
	});
}

export class MailService extends Context.Service<MailService, MailServiceContract>()(
	"MailService",
	{
		make: createMailServiceEffect(),
	},
) {}

export const MailServiceLive = Layer.effect(MailService, MailService.make).pipe(
	Layer.provide(Layer.effect(AppConfig, AppConfig.make)),
);
