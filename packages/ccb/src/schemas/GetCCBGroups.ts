import { Schema as S } from "effect";

export const ArgumentAttributesSchema = S.Struct({
	value: S.optional(S.String),
	name: S.optional(S.String),
});
export type ArgumentAttributes = typeof ArgumentAttributesSchema.Type;

export const AvailabilitySchema = S.String;
export type Availability = typeof AvailabilitySchema.Type;

export const GroupsAttributesSchema = S.Struct({
	count: S.optional(S.String),
});
export type GroupsAttributes = typeof GroupsAttributesSchema.Type;

export const AddressAttributesSchema = S.Struct({
	type: S.optional(S.String),
});
export type AddressAttributes = typeof AddressAttributesSchema.Type;

export const LeadersSchema = S.Union([S.Struct({}), S.String]);
export type Leaders = typeof LeadersSchema.Type;

const StringOrEmptyStructSchema = S.Union([S.String, S.Struct({})]);

export const GroupAttributesSchema = S.Struct({
	id: S.optional(S.String),
});
export type GroupAttributes = typeof GroupAttributesSchema.Type;

export const PhoneSchema = S.Union([
	S.Struct({
		_attributes: S.optional(AddressAttributesSchema),
		_text: S.optional(S.String),
	}),
	S.String,
]);
export type Phone = typeof PhoneSchema.Type;

export const MeetingSchema = S.Union([
	S.Struct({
		_attributes: S.optional(GroupAttributesSchema),
	}),
	S.String,
]);
export type Meeting = typeof MeetingSchema.Type;

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

export const AddressSchema = S.Struct({
	_attributes: S.optional(AddressAttributesSchema),
	name: S.optional(S.String),
	street_address: S.optional(S.String),
	city: S.optional(S.String),
	state: S.optional(LeadersSchema),
	zip: S.optional(LeadersSchema),
	longitude: S.optional(LeadersSchema),
	latitude: S.optional(LeadersSchema),
	line_1: S.optional(S.String),
	line_2: S.optional(S.String),
});
export type Address = typeof AddressSchema.Type;

export const AreaSchema = S.Union([
	S.Struct({
		_attributes: S.optional(GroupAttributesSchema),
		_text: S.optional(S.String),
	}),
	S.String,
]);
export type Area = typeof AreaSchema.Type;

export const DeclarationSchema = S.Union([
	S.Struct({
		_attributes: S.optional(DeclarationAttributesSchema),
	}),
	S.String,
]);
export type Declaration = typeof DeclarationSchema.Type;

export const ParametersSchema = S.Struct({
	argument: S.optional(S.Array(ArgumentSchema)),
});
export type Parameters = typeof ParametersSchema.Type;

export const AddressesSchema = S.Union([
	S.Struct({
		address: S.optional(AddressSchema),
	}),
	S.String,
]);
export type Addresses = typeof AddressesSchema.Type;

export const RequestSchema = S.Struct({
	parameters: S.optional(ParametersSchema),
});
export type Request = typeof RequestSchema.Type;

export const PhonesSchema = S.Struct({
	phone: S.optional(S.Union([S.Number, S.String])),
});
export type Phones = typeof PhonesSchema.Type;

export const MainLeaderSchema2 = S.Struct({
	first_name: S.optional(S.String),
	last_name: S.optional(S.String),
	full_name: S.optional(S.String),
	email: S.optional(S.String),
	phones: S.optional(PhonesSchema),
});

export const GroupSchema = S.Struct({
	name: S.optional(S.String),
	description: S.optional(S.String),
	image: S.optional(S.String),
	campus: S.optional(S.String),
	main_leader: S.optional(MainLeaderSchema2),
	leaders: S.optional(StringOrEmptyStructSchema),
	participants: S.optional(StringOrEmptyStructSchema),
	group_type: S.optional(S.String),
	department: S.optional(S.String),
	area: S.optional(AreaSchema),
	calendar_feed: S.optional(S.String),
	registration_forms: S.optional(StringOrEmptyStructSchema),
	current_members: S.optional(S.Union([S.NumberFromString, S.Number])),
	group_capacity: S.optional(S.String),
	addresses: S.optional(AddressesSchema),
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
export type Group = typeof GroupSchema.Type;

export const GroupsSchema = S.Struct({
	_attributes: S.optional(GroupsAttributesSchema),
	group: S.optional(S.Array(GroupSchema)),
	_text: S.optional(S.String),
});
export type Groups = typeof GroupsSchema.Type;

export const ResponseSchema = S.Struct({
	service: S.optional(S.String),
	service_action: S.optional(S.String),
	availability: S.optional(S.String),
	groups: S.optional(GroupsSchema),
});
export type Response = typeof ResponseSchema.Type;

export const CcbApiSchema = S.Struct({
	request: S.optional(RequestSchema),
	response: S.optional(ResponseSchema),
});
export type CcbApi = typeof CcbApiSchema.Type;

export const CCBGroupsSchema = S.Struct({
	_declaration: S.optional(DeclarationSchema),
	ccb_api: S.optional(CcbApiSchema),
});
export type CCBGroups = typeof CCBGroupsSchema.Type;
