import { Schema } from "effect";

export class StrapiV2Error extends Schema.TaggedError<StrapiV2Error>()("StrapiV2Error", {
	reason: Schema.Literals(["Transport", "Status", "GraphQL", "Decode"]),
	operation: Schema.String,
	detail: Schema.String,
	status: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `Strapi 5 ${this.operation} failed (${this.reason}): ${this.detail}`;
	}
}
