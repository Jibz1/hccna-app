import { Schema } from "effect";

export class PushTokenRegistrationError extends Schema.TaggedError<PushTokenRegistrationError>()(
	"PushTokenRegistrationError",
	{
		detail: Schema.String,
		retryable: Schema.optional(Schema.Boolean),
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Push token registration: ${this.detail}`;
	}
}

export class PushSendError extends Schema.TaggedError<PushSendError>()("PushSendError", {
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `Push send: ${this.detail}`;
	}
}
