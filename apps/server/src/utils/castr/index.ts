import { Schema } from "effect";

import type { BroadcastingStatus } from "@hccnj/castr";

export { type Doc, type LiveStreams, type UpdatePlatformRequest } from "@hccnj/castr";

// Firebase Castr Stream Schema
const BroadcastingStatusEffectSchema: Schema.Schema<BroadcastingStatus> = Schema.Literals([
	"offline",
	"online",
]);

const FirebaseCastrPlatformSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	enabled: Schema.Boolean,
	template: Schema.String,
	server: Schema.String,
	key: Schema.String,
	broadcasting_status: BroadcastingStatusEffectSchema,
});

const FirebaseCastrStreamSchema = Schema.Struct({
	name: Schema.String,
	enabled: Schema.Boolean,
	id: Schema.String,
	broadcasting_status: BroadcastingStatusEffectSchema,
	title: Schema.String,
	description: Schema.String,
	platforms: Schema.Array(FirebaseCastrPlatformSchema),
	// Raw Firestore value; read it through decodePlatformMetadataByPlatformId.
	platformMetadata: Schema.optional(Schema.Unknown),
	last_updated: Schema.Date,
});
export type FirebaseCastrStream = typeof FirebaseCastrStreamSchema.Type;
