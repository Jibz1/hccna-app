// oxlint-disable max-classes-per-file

import { Schema } from "effect";

export class VodFetchError extends Schema.TaggedError<VodFetchError>()("VodFetchError", {
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `VOD fetch: ${this.detail}`;
	}
}

export class VodNotFoundError extends Schema.TaggedError<VodNotFoundError>()("VodNotFoundError", {
	resource: Schema.String,
}) {
	override get message() {
		return `VOD not found: ${this.resource}`;
	}
}

export class VodSetError extends Schema.TaggedError<VodSetError>()("VodSetError", {
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `VOD set: ${this.detail}`;
	}
}

export class VodPushNotificationError extends Schema.TaggedError<VodPushNotificationError>()(
	"VodPushNotificationError",
	{
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `VOD push notification: ${this.detail}`;
	}
}
