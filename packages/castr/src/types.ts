import { Data, Schema } from "effect";

export const BroadcastingStatusSchema = Schema.Literals(["offline", "online"]);
export type BroadcastingStatus = typeof BroadcastingStatusSchema.Type;

export const IngestSchema = Schema.Struct({
	server: Schema.String,
	key: Schema.String,
});
export type Ingest = typeof IngestSchema.Type;

export const PlatformSchema = Schema.Struct({
	_id: Schema.String,
	name: Schema.String,
	enabled: Schema.Boolean,
	template: Schema.String,
	server: Schema.String,
	key: Schema.String,
	broadcasting_status: BroadcastingStatusSchema,
});
export type Platform = typeof PlatformSchema.Type;

export const PlaybackSchema = Schema.Struct({
	embed_url: Schema.String,
	hls_url: Schema.Any,
});
export type Playback = typeof PlaybackSchema.Type;

export const SettingsSchema = Schema.Struct({
	abr: Schema.Boolean,
	country_block: Schema.Array(Schema.Any),
	country_whitelist: Schema.Array(Schema.Any),
	domain_whitelist: Schema.Array(Schema.Any),
	embed_password: Schema.Boolean,
	chat_enabled: Schema.Boolean,
});
export type Settings = typeof SettingsSchema.Type;

export const DocSchema = Schema.Struct({
	_id: Schema.String,
	name: Schema.String,
	enabled: Schema.Boolean,
	ingest: IngestSchema,
	playback: PlaybackSchema,
	platforms: Schema.Array(PlatformSchema),
	settings: SettingsSchema,
	broadcasting_status: BroadcastingStatusSchema,
	user: Schema.String,
	creation_time: Schema.Union([Schema.Date, Schema.DateFromString]),
});
export type Doc = typeof DocSchema.Type;

export const LiveStreamsSchema = Schema.Struct({
	total: Schema.Number,
	page: Schema.Number,
	pages: Schema.Number,
	docs: Schema.Array(DocSchema),
});
export type LiveStreams = typeof LiveStreamsSchema.Type;

export const MetadataSchema = Schema.Struct({
	title: Schema.String,
	description: Schema.String,
});
export type Metadata = typeof MetadataSchema.Type;

export const UpdatePlatformRequestSchema = Schema.Struct({
	name: Schema.optional(Schema.String),
	enabled: Schema.Boolean,
	key: Schema.optional(Schema.String),
	template: Schema.optional(Schema.String),
	server: Schema.optional(Schema.String),
	metadata: Schema.optional(MetadataSchema),
});
export type UpdatePlatformRequest = typeof UpdatePlatformRequestSchema.Type;

export const UpdatePlatformResponseSchema = Schema.NullOr(
	Schema.Record(Schema.String, Schema.Unknown),
);

export enum CASTRRequestType {
	GET_LIVE_STREAMS = "live_streams",
	UPDATE_PLATFORM = "update_platform",
}

export const CASTR_Response = {
	[CASTRRequestType.GET_LIVE_STREAMS]: LiveStreamsSchema,
	[CASTRRequestType.UPDATE_PLATFORM]: UpdatePlatformResponseSchema,
} as const satisfies Record<CASTRRequestType, Schema.Schema<unknown>>;

export type CASTRResponse = {
	[K in CASTRRequestType]: (typeof CASTR_Response)[K]["Type"];
};

export class CastrFetchError extends Data.TaggedError("CastrFetchError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class CastrParseError extends Data.TaggedError("CastrParseError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class CastrPatchError extends Data.TaggedError("CastrPatchError")<{
	readonly message: string;
	readonly cause?: unknown;
	/** HTTP status when Castr answered with an error response. */
	readonly status?: number;
	/** Start of Castr's error response body, for diagnosing its rejections. */
	readonly body?: string;
}> {}

export type CastrError = CastrFetchError | CastrParseError | CastrPatchError;
