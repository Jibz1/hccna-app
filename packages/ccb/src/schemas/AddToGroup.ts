import { Schema as S } from "effect";

export const ArgumentAttributesSchema = S.Struct({
	value: S.optional(S.String),
	name: S.optional(S.String),
});
export type ArgumentAttributes = typeof ArgumentAttributesSchema.Type;

export const AvailabilitySchema = S.Struct({
	_text: S.optional(S.String),
});
export type Availability = typeof AvailabilitySchema.Type;

export const GroupsAttributesSchema = S.Struct({
	count: S.optional(S.String),
});
export type GroupsAttributes = typeof GroupsAttributesSchema.Type;

export const AddressesSchema = S.Struct({});
export type Addresses = typeof AddressesSchema.Type;

export const GroupAttributesSchema = S.Struct({
	id: S.optional(S.String),
});
export type GroupAttributes = typeof GroupAttributesSchema.Type;

export const CampusSchema = S.Struct({
	_attributes: S.optional(GroupAttributesSchema),
	_text: S.optional(S.String),
});
export type Campus = typeof CampusSchema.Type;

export const PhoneAttributesSchema = S.Struct({
	type: S.optional(S.String),
});
export type PhoneAttributes = typeof PhoneAttributesSchema.Type;

export const DeclarationAttributesSchema = S.Struct({
	version: S.optional(S.String),
	encoding: S.optional(S.String),
});
export type DeclarationAttributes = typeof DeclarationAttributesSchema.Type;

export const ArgumentSchema = S.Struct({
	_attributes: S.optional(ArgumentAttributesSchema),
});
export type Argument = typeof ArgumentSchema.Type;

export const AreaSchema = S.Struct({
	_attributes: S.optional(GroupAttributesSchema),
});
export type Area = typeof AreaSchema.Type;

export const PhoneSchema = S.Struct({
	_attributes: S.optional(PhoneAttributesSchema),
});
export type Phone = typeof PhoneSchema.Type;

export const DeclarationSchema = S.Struct({
	_attributes: S.optional(DeclarationAttributesSchema),
});
export type Declaration = typeof DeclarationSchema.Type;

export const ParametersSchema = S.Struct({
	argument: S.optional(S.Array(ArgumentSchema)),
});
export type Parameters = typeof ParametersSchema.Type;

export const PhonesSchema = S.Struct({
	phone: S.optional(PhoneSchema),
});
export type Phones = typeof PhonesSchema.Type;

export const RequestSchema = S.Struct({
	parameters: S.optional(ParametersSchema),
});
export type Request = typeof RequestSchema.Type;

export const LeaderSchema = S.Struct({
	_attributes: S.optional(GroupAttributesSchema),
	first_name: S.optional(AvailabilitySchema),
	last_name: S.optional(AvailabilitySchema),
	full_name: S.optional(AvailabilitySchema),
	email: S.optional(AvailabilitySchema),
	phones: S.optional(PhonesSchema),
});
export type Leader = typeof LeaderSchema.Type;

export const LeadersSchema = S.Struct({
	leader: S.optional(LeaderSchema),
});
export type Leaders = typeof LeadersSchema.Type;

export const GroupSchema = S.Struct({
	_attributes: S.optional(GroupAttributesSchema),
	name: S.optional(AvailabilitySchema),
	description: S.optional(AvailabilitySchema),
	image: S.optional(AvailabilitySchema),
	campus: S.optional(CampusSchema),
	main_leader: S.optional(LeaderSchema),
	leaders: S.optional(LeadersSchema),
	participants: S.optional(AddressesSchema),
	group_type: S.optional(CampusSchema),
	department: S.optional(AreaSchema),
	area: S.optional(AreaSchema),
	calendar_feed: S.optional(AvailabilitySchema),
	registration_forms: S.optional(AddressesSchema),
	current_members: S.optional(AvailabilitySchema),
	group_capacity: S.optional(AvailabilitySchema),
	addresses: S.optional(AddressesSchema),
	meeting_day: S.optional(AreaSchema),
	meeting_time: S.optional(AreaSchema),
	childcare_provided: S.optional(AvailabilitySchema),
	interaction_type: S.optional(AvailabilitySchema),
	membership_type: S.optional(AvailabilitySchema),
	notification: S.optional(AvailabilitySchema),
	user_defined_fields: S.optional(AddressesSchema),
	listed: S.optional(AvailabilitySchema),
	public_search_listed: S.optional(AvailabilitySchema),
	inactive: S.optional(AvailabilitySchema),
	creator: S.optional(CampusSchema),
	modifier: S.optional(CampusSchema),
	created: S.optional(AvailabilitySchema),
	modified: S.optional(AvailabilitySchema),
});
export type Group = typeof GroupSchema.Type;

export const GroupsSchema = S.Struct({
	_attributes: S.optional(GroupsAttributesSchema),
	group: S.optional(GroupSchema),
});
export type Groups = typeof GroupsSchema.Type;

export const ResponseSchema = S.Struct({
	service: S.optional(AvailabilitySchema),
	service_action: S.optional(AvailabilitySchema),
	availability: S.optional(AvailabilitySchema),
	groups: S.optional(GroupsSchema),
});
export type Response = typeof ResponseSchema.Type;

export const CcbApiSchema = S.Struct({
	request: S.optional(RequestSchema),
	response: S.optional(ResponseSchema),
});
export type CcbApi = typeof CcbApiSchema.Type;

export const AddToGroupSchema = S.Struct({
	_declaration: S.optional(DeclarationSchema),
	ccb_api: S.optional(CcbApiSchema),
});
export type AddToGroup = typeof AddToGroupSchema.Type;
