import { Schema as S } from "effect";

export const ArgumentSchema = S.Struct({
	_value: S.String,
	_name: S.String,
});
export type Argument = typeof ArgumentSchema.Type;

export const AttendeeSchema = S.Struct({
	first_name: S.String,
	last_name: S.String,
	id: S.String,
});
export type Attendee = typeof AttendeeSchema.Type;

export const ParametersSchema = S.Struct({
	argument: S.Array(ArgumentSchema),
});
export type Parameters = typeof ParametersSchema.Type;

export const AttendeesSchema = S.Struct({
	attendee: S.Array(AttendeeSchema),
});
export type Attendees = typeof AttendeesSchema.Type;

export const RequestSchema = S.Struct({
	parameters: ParametersSchema,
});
export type Request = typeof RequestSchema.Type;

export const EventSchema = S.Struct({
	name: S.String,
	occurrence: S.String,
	did_not_meet: S.optional(S.Boolean),
	topic: S.optional(S.String),
	notes: S.optional(S.String),
	prayer_requests: S.optional(S.String),
	info: S.optional(S.String),
	attendees: AttendeesSchema,
	head_count: S.Number,
	id: S.String,
});
export type Event = typeof EventSchema.Type;

export const EventsSchema = S.Struct({
	event: EventSchema,
	count: S.String,
});
export type Events = typeof EventsSchema.Type;

export const ResponseSchema = S.Struct({
	events: EventsSchema,
});
export type Response = typeof ResponseSchema.Type;

export const AttributesSchema = S.Struct({
	count: S.String,
});
export type Attributes = typeof AttributesSchema.Type;

export const MessageSchema = S.Struct({
	text: S.String,
});
export type Message = typeof MessageSchema.Type;

export const MessagesSchema = S.Struct({
	attributes: AttributesSchema,
	message: MessageSchema,
});
export type Messages = typeof MessagesSchema.Type;

export const CcbApiSchema = S.Struct({
	request: RequestSchema,
	response: S.optional(ResponseSchema),
	messages: S.optional(MessagesSchema),
});
export type CcbApi = typeof CcbApiSchema.Type;

export const AttendanceProfileSchema = S.Struct({
	ccb_api: CcbApiSchema,
});
export type AttendanceProfile = typeof AttendanceProfileSchema.Type;
