import { Schema as S } from "effect";

export const DeclarationAttributesSchema = S.Struct({
	version: S.optional(S.NullOr(S.String)),
	encoding: S.optional(S.NullOr(S.String)),
});
export type DeclarationAttributes = typeof DeclarationAttributesSchema.Type;

export const DeclarationSchema = S.Struct({
	_attributes: S.optional(S.NullOr(DeclarationAttributesSchema)),
});
export type Declaration = typeof DeclarationSchema.Type;

export const IndividualIdAttributesSchema = S.Struct({
	type: S.optional(S.NullOr(S.String)),
});
export type IndividualIdAttributes = typeof IndividualIdAttributesSchema.Type;

export const IndividualIdSchema = S.Struct({
	_attributes: S.optional(S.NullOr(IndividualIdAttributesSchema)),
	_text: S.optional(S.NullOr(S.String)),
});
export type IndividualId = typeof IndividualIdSchema.Type;

export const AvailabilitySchema = S.Struct({
	_text: S.optional(S.NullOr(S.String)),
});

const StringOrEmptyStructSchema = S.Union([S.String, S.Struct({})]);

export const GroupSchema = S.Struct({
	group_id: S.optional(S.NullOr(AvailabilitySchema)),
	id: S.optional(S.NullOr(AvailabilitySchema)),
	name: S.optional(S.NullOr(AvailabilitySchema)),
	receive_email_from_group: S.optional(S.Union([AvailabilitySchema, S.Null, S.String])),
	receive_sms_from_group: S.optional(S.Union([AvailabilitySchema, S.Null, S.String])),
	notify_comments: S.optional(S.Union([AvailabilitySchema, S.Null, S.String])),
	date_modified: S.optional(S.Union([AvailabilitySchema, S.Null, S.String])),
	status: S.optional(S.Union([AvailabilitySchema, S.Null, S.String])),
});
export type Group = typeof GroupSchema.Type;

export const IndividualsAttributesSchema = S.Struct({
	count: S.optional(S.NullOr(S.String)),
});

const NullableGroupArraySchema = S.NullOr(S.Array(GroupSchema));

export const GroupsSchema = S.Struct({
	_attributes: S.optional(S.NullOr(IndividualsAttributesSchema)),
	group: S.optional(NullableGroupArraySchema),
});
export const GroupSchema2 = S.Array(GroupSchema);
export type Groups = typeof GroupsSchema.Type;

export const IndividualSchema = S.Struct({
	individual_id: S.optional(S.NullOr(IndividualIdSchema)),
	id: S.optional(S.NullOr(AvailabilitySchema)),
	name_first: S.optional(S.NullOr(AvailabilitySchema)),
	name_last: S.optional(S.NullOr(AvailabilitySchema)),
	full_name: S.optional(S.NullOr(AvailabilitySchema)),
	receive_email_from_church: S.optional(S.NullOr(AvailabilitySchema)),
	groups: S.optional(S.NullOr(GroupsSchema)),
});
export type Individual = typeof IndividualSchema.Type;

export type IndividualsAttributes = typeof IndividualsAttributesSchema.Type;

export const IndividualsSchema = S.Struct({
	_attributes: S.optional(S.NullOr(IndividualsAttributesSchema)),
	individual: S.optional(S.NullOr(IndividualSchema)),
});
export type Individuals = typeof IndividualsSchema.Type;

export type Availability = typeof AvailabilitySchema.Type;

export const ResponseSchema = S.Struct({
	service: S.optional(S.NullOr(AvailabilitySchema)),
	service_action: S.optional(S.NullOr(AvailabilitySchema)),
	availability: S.optional(S.NullOr(AvailabilitySchema)),
	individuals: S.optional(S.NullOr(IndividualsSchema)),
});
export type Response = typeof ResponseSchema.Type;

export const ArgumentAttributesSchema = S.Struct({
	value: S.optional(S.NullOr(S.String)),
	name: S.optional(S.NullOr(S.String)),
});
export type ArgumentAttributes = typeof ArgumentAttributesSchema.Type;

export const ArgumentSchema = S.Struct({
	_attributes: S.optional(S.NullOr(ArgumentAttributesSchema)),
});
export type Argument = typeof ArgumentSchema.Type;

const NullableArgumentListSchema = S.NullOr(S.Array(ArgumentSchema));

export const ParametersSchema = S.Struct({
	argument: S.optional(NullableArgumentListSchema),
});
export type Parameters = typeof ParametersSchema.Type;

export const RequestSchema = S.Struct({
	parameters: S.optional(S.NullOr(ParametersSchema)),
});
export type Request = typeof RequestSchema.Type;

export const CcbApiSchema = S.Struct({
	request: S.optional(S.NullOr(RequestSchema)),
	response: S.optional(S.NullOr(ResponseSchema)),
});
export type CcbApi = typeof CcbApiSchema.Type;

export const GetUserGroupsByIdSchema = S.Struct({
	_declaration: S.optional(S.NullOr(DeclarationSchema)),
	ccb_api: S.optional(S.NullOr(CcbApiSchema)),
});
export type GetUserGroupsById = typeof GetUserGroupsByIdSchema.Type;

export const PhonesSchema = S.Struct({
	phone: S.optional(S.Union([S.Number, S.String])),
});
export type Phones = typeof PhonesSchema.Type;

export const MainLeaderSchema = S.Struct({
	first_name: S.optional(S.String),
	last_name: S.optional(S.String),
	full_name: S.optional(S.String),
	email: S.optional(S.String),
	phones: S.optional(PhonesSchema),
});
export type MainLeader = typeof MainLeaderSchema.Type;

export const CCBGroupSchema = S.Struct({
	name: S.optional(S.String),
	description: S.optional(S.String),
	image: S.optional(S.String),
	campus: S.optional(S.String),
	main_leader: S.optional(MainLeaderSchema),
	leaders: S.optional(StringOrEmptyStructSchema),
	participants: S.optional(StringOrEmptyStructSchema),
	group_type: S.optional(S.String),
	department: S.optional(S.String),
	area: S.optional(S.String),
	calendar_feed: S.optional(S.String),
	registration_forms: S.optional(StringOrEmptyStructSchema),
	current_members: S.optional(S.Union([S.NumberFromString, S.Number])),
	group_capacity: S.optional(S.String),
	addresses: S.optional(StringOrEmptyStructSchema),
	meeting_day: S.optional(S.String),
	meeting_time: S.optional(S.String),
	childcare_provided: S.optional(S.Union([S.String, S.Boolean])),
	interaction_type: S.optional(S.String),
	membership_type: S.optional(S.String),
	notification: S.optional(S.Union([S.String, S.Boolean])),
	user_defined_fields: S.optional(S.String),
	listed: S.optional(S.Union([S.String, S.Boolean])),
	public_search_listed: S.optional(S.Union([S.String, S.Boolean])),
	inactive: S.optional(S.Union([S.String, S.Boolean])),
	creator: S.optional(S.String),
	modifier: S.optional(S.String),
	created: S.optional(S.String),
	modified: S.optional(S.String),
});
export const CCBGroupsSchema = S.Array(CCBGroupSchema);
export type CCBGroup = typeof CCBGroupSchema.Type;
export type CCBGroups = typeof CCBGroupsSchema.Type;
