import { Schema as S } from "effect";

export const ArgumentAttributesSchema = S.Struct({
	value: S.optional(S.String),
	name: S.optional(S.String),
});
export type ArgumentAttributes = typeof ArgumentAttributesSchema.Type;

export const AvailabilitySchema = S.Union([S.Struct({}), S.Number, S.String]);
export type Availability = typeof AvailabilitySchema.Type;

export const IndividualsAttributesSchema = S.Struct({
	count: S.optional(S.String),
});
export type IndividualsAttributes = typeof IndividualsAttributesSchema.Type;

export const IndividualIdAttributesSchema = S.Struct({
	type: S.optional(S.String),
});
export type IndividualIdAttributes = typeof IndividualIdAttributesSchema.Type;

export const ReceiveSmsFromGroupSchema = S.Struct({});
export type ReceiveSmsFromGroup = typeof ReceiveSmsFromGroupSchema.Type;

const EmptyStructSchema = S.Struct({});

const GroupIdLiteralSchema = S.Struct({
	type: S.Literal("groups"),
	_content: S.optional(S.String),
});

const IndividualIdLiteralSchema = S.Struct({
	type: S.Literal("individual"),
	_content: S.optional(S.String),
});

const NumberOrEmptyStructSchema = S.Union([S.Number, EmptyStructSchema]);
const GroupIdOrNumberSchema = S.Union([GroupIdLiteralSchema, S.Number]);

export const DeclarationAttributesSchema = S.Struct({
	version: S.optional(S.String),
	encoding: S.optional(S.String),
});
export type DeclarationAttributes = typeof DeclarationAttributesSchema.Type;

export const ArgumentSchema = S.Union([
	S.Struct({
		_attributes: S.optional(ArgumentAttributesSchema),
	}),
	S.String,
]);
export type Argument = typeof ArgumentSchema.Type;

export const IdSchema = S.Union([
	S.Struct({
		_attributes: S.optional(IndividualIdAttributesSchema),
		_text: S.optional(S.String),
	}),
	S.String,
]);
export type Id = typeof IdSchema.Type;

export const DeclarationSchema = S.Union([
	S.Struct({
		_attributes: S.optional(DeclarationAttributesSchema),
	}),
	S.Null,
	S.String,
]);
export type Declaration = typeof DeclarationSchema.Type;

export const ParametersSchema = S.Struct({
	argument: S.optional(S.Array(ArgumentSchema)),
});
export type Parameters = typeof ParametersSchema.Type;

export const GroupSchema = S.Struct({
	group_id: S.optional(S.Union([IdSchema, S.Number])),
	id: S.optional(AvailabilitySchema),
	name: S.optional(AvailabilitySchema),
	receive_email_from_group: S.optional(AvailabilitySchema),
	receive_sms_from_group: S.optional(S.Union([ReceiveSmsFromGroupSchema, S.Number, S.String])),
	notify_comments: S.optional(AvailabilitySchema),
});
export type Group = typeof GroupSchema.Type;

const GroupArraySchema = S.Array(GroupSchema);
const GroupCollectionSchema = S.Struct({
	count: S.optional(S.String),
	group: S.optional(GroupArraySchema),
});

export const RequestSchema = S.Struct({
	parameters: S.optional(ParametersSchema),
});
export type Request = typeof RequestSchema.Type;

export const GroupsSchema = S.Union([
	S.Struct({
		group_id: S.optional(GroupIdOrNumberSchema),
		id: S.optional(S.String),
		name: S.optional(S.String),
		receive_email_from_group: S.optional(NumberOrEmptyStructSchema),
		receive_sms_from_group: S.optional(NumberOrEmptyStructSchema),
		notify_comments: S.optional(S.String),
	}),
	S.String,
]);

export type Groups = typeof GroupsSchema.Type;

export const IndividualSchema = S.Struct({
	individual_id: S.optional(S.Union([IndividualIdLiteralSchema, S.Number])),
	id: S.optional(S.Union([S.String, S.Number])),
	name_first: S.optional(S.String),
	name_last: S.optional(S.String),
	full_name: S.optional(S.String),
	receive_email_from_church: S.optional(S.Number),
	groups: GroupCollectionSchema,
});
export type Individual = typeof IndividualSchema.Type;

export const IndividualsSchema = S.Struct({
	_attributes: S.optional(IndividualsAttributesSchema),
	individual: S.optional(IndividualSchema),
});
export type Individuals = typeof IndividualsSchema.Type;

export const ResponseSchema = S.Struct({
	service: S.optional(AvailabilitySchema),
	service_action: S.optional(AvailabilitySchema),
	availability: S.optional(AvailabilitySchema),
	individuals: S.optional(IndividualsSchema),
});
export type Response = typeof ResponseSchema.Type;

export const CcbApiSchema = S.Struct({
	request: S.optional(RequestSchema),
	response: S.optional(ResponseSchema),
});
export type CcbApi = typeof CcbApiSchema.Type;

export const GroupByIdSchema = S.Struct({
	_declaration: S.optional(DeclarationSchema),
	ccb_api: S.optional(CcbApiSchema),
});
export type GroupById = typeof GroupByIdSchema.Type;
