import { Schema as S } from "effect";

export const ArgumentSchema = S.Struct({
	value: S.String,
	name: S.optional(S.String),
});
export type Argument = typeof ArgumentSchema.Type;

export const CarrierSchema = S.Struct({
	id: S.optional(S.String),
});
export type Carrier = typeof CarrierSchema.Type;

export const CreatorSchema = S.Struct({
	id: S.optional(S.String),
	text: S.optional(S.String),
});
export type Creator = typeof CreatorSchema.Type;

export const ParametersSchema = S.Struct({
	argument: S.Array(ArgumentSchema),
});
export type Parameters = typeof ParametersSchema.Type;

export const ParticipantSchema = S.Struct({
	name: S.String,
	email: S.String,
	mobile_phone: S.optional(S.Union([S.String, S.Null, S.Number])),
	carrier: CarrierSchema,
	receive_email_from_church: S.optional(S.Boolean),
	receive_email_from_group: S.optional(S.Boolean),
	receive_sms_from_group: S.optional(S.Boolean),
	status: CreatorSchema,
	date_joined: S.String,
	active: S.optional(S.Boolean),
	creator: CreatorSchema,
	modifier: CreatorSchema,
	created: S.String,
	modified: S.String,
	first_name: S.optional(S.String),
	last_name: S.optional(S.String),
	middle_name: S.optional(S.String),
	legal_first_name: S.optional(S.String),
	salutation: S.optional(S.String),
	suffix: S.optional(S.String),
	id: S.optional(S.String),
});
export type Participant = typeof ParticipantSchema.Type;

export const RequestSchema = S.Struct({
	parameters: ParametersSchema,
});
export type Request = typeof RequestSchema.Type;

export const ParticipantsSchema = S.Struct({
	participant: S.Array(ParticipantSchema),
	count: S.optional(S.String),
	text: S.optional(S.String),
});
export type Participants = typeof ParticipantsSchema.Type;

export const GroupSchema = S.Struct({
	participants: ParticipantsSchema,
	id: S.optional(S.String),
	name: S.optional(S.String),
});
export type Group = typeof GroupSchema.Type;

export const GroupsSchema = S.Struct({
	group: GroupSchema,
	count: S.optional(S.String),
});
export type Groups = typeof GroupsSchema.Type;

export const GroupParticipantsSchema = S.Struct({
	service: S.String,
	service_action: S.String,
	availability: S.String,
	groups: GroupsSchema,
});
export type Response = typeof GroupParticipantsSchema.Type;

export const CcbApiSchema = S.Struct({
	request: RequestSchema,
	response: GroupParticipantsSchema,
});

export type CcbApi = typeof CcbApiSchema.Type;

export const GroupParticipantsSchema1 = S.Struct({
	_declaration: S.optional(S.Any),
	ccb_api: CcbApiSchema,
});
export type GroupParticipants = typeof GroupParticipantsSchema1.Type;
