import { Schema } from "effect";

// ═══════════════════════════════════════════════════════════════
// CMS ERROR TYPES
// ═══════════════════════════════════════════════════════════════

export class CMSFetchError extends Schema.TaggedError<CMSFetchError>()("CMSFetchError", {
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `CMS fetch: ${this.detail}`;
	}
}

export class CMSNotFoundError extends Schema.TaggedError<CMSNotFoundError>()("CMSNotFoundError", {
	resource: Schema.String,
}) {
	override get message() {
		return `CMS not found: ${this.resource}`;
	}
}

// type CMSError = CMSFetchError | CMSNotFoundError;
