import { Schema as S } from "effect";

export const ArgumentAttributesSchema = S.Struct({
	value: S.optional(S.String),
	name: S.optional(S.String),
	id: S.optional(S.String),
});
export type ArgumentAttributes = typeof ArgumentAttributesSchema.Type;

export const AvailabilitySchema = S.Struct({
	_text: S.optional(S.String),
});
export type Availability = typeof AvailabilitySchema.Type;

export const DeclarationAttributesSchema = S.Struct({
	version: S.optional(S.String),
	encoding: S.optional(S.String),
});
export type DeclarationAttributes = typeof DeclarationAttributesSchema.Type;

export const ArgumentSchema = S.Struct({
	_attributes: S.optional(ArgumentAttributesSchema),
});
export type Argument = typeof ArgumentSchema.Type;

export const DeclarationSchema = S.Struct({
	_attributes: S.optional(DeclarationAttributesSchema),
});
export type Declaration = typeof DeclarationSchema.Type;

export const ParametersSchema = S.Struct({
	argument: S.optional(S.Array(ArgumentSchema)),
});
export type Parameters = typeof ParametersSchema.Type;

export const RequestSchema = S.Struct({
	parameters: S.optional(ParametersSchema),
});
export type Request = typeof RequestSchema.Type;

export const IndividualsAttributesSchema = S.Struct({
	count: S.optional(S.String),
});
export type IndividualsAttributes = typeof IndividualsAttributesSchema.Type;

export const ActiveSchema = S.Struct({
	_text: S.optional(S.String),
});
export type Active = typeof ActiveSchema.Type;

export const AddressAttributesSchema = S.Any;
export type AddressAttributes = typeof AddressAttributesSchema.Type;

export const AllergiesSchema = S.Any;
export type Allergies = typeof AllergiesSchema.Type;

export const CountryAttributesSchema = S.Struct({
	code: S.optional(S.String),
});
export type CountryAttributes = typeof CountryAttributesSchema.Type;

export const IndividualAttributesSchema = S.Struct({
	id: S.optional(S.String),
});
export type IndividualAttributes = typeof IndividualAttributesSchema.Type;

export const CampusSchema = S.Struct({
	_attributes: S.optional(IndividualAttributesSchema),
	_text: S.optional(S.String),
});
export type Campus = typeof CampusSchema.Type;

export const CreatedSchema = S.Struct({
	_text: S.optional(S.String),
});
export type Created = typeof CreatedSchema.Type;

export const ImageSchema = S.Struct({
	_text: S.optional(S.String),
});
export type Image = typeof ImageSchema.Type;

export const PhoneSchema = S.Struct({
	_attributes: S.optional(AddressAttributesSchema),
	_text: S.optional(S.String),
});
export type Phone = typeof PhoneSchema.Type;

export const PrivacySettingsSchema = S.Struct({
	profile_listed: S.optional(ActiveSchema),
	mailing_address: S.optional(CampusSchema),
	home_address: S.optional(CampusSchema),
	contact_phone: S.optional(CampusSchema),
	home_phone: S.optional(CampusSchema),
	work_phone: S.optional(CampusSchema),
	mobile_phone: S.optional(CampusSchema),
	emergency_phone: S.optional(CampusSchema),
	birthday: S.optional(CampusSchema),
	anniversary: S.optional(CampusSchema),
	gender: S.optional(CampusSchema),
	marital_status: S.optional(CampusSchema),
	user_defined_fields: S.optional(CampusSchema),
	allergies: S.optional(CampusSchema),
});
export type PrivacySettings = typeof PrivacySettingsSchema.Type;

export const CountrySchema = S.Struct({
	_attributes: S.optional(CountryAttributesSchema),
});
export type Country = typeof CountrySchema.Type;

export const PhonesSchema = S.Struct({
	phone: S.optional(S.Array(PhoneSchema)),
});
export type Phones = typeof PhonesSchema.Type;

export const AddressSchema = S.Struct({
	_attributes: S.optional(AddressAttributesSchema),
	street_address: S.optional(AllergiesSchema),
	city: S.optional(AllergiesSchema),
	state: S.optional(AllergiesSchema),
	zip: S.optional(AllergiesSchema),
	country: S.optional(CountrySchema),
	line_1: S.optional(AllergiesSchema),
	line_2: S.optional(AllergiesSchema),
	latitude: S.optional(AllergiesSchema),
	longitude: S.optional(AllergiesSchema),
});
export type Address = typeof AddressSchema.Type;

export const AddressesSchema = S.Struct({
	address: S.optional(S.Array(AddressSchema)),
});
export type Addresses = typeof AddressesSchema.Type;

export const IndividualSchema = S.Struct({
	_attributes: S.optional(IndividualAttributesSchema),
	sync_id: S.optional(AllergiesSchema),
	other_id: S.optional(AllergiesSchema),
	giving_number: S.optional(AllergiesSchema),
	campus: S.optional(CampusSchema),
	family: S.optional(CampusSchema),
	family_image: S.optional(ImageSchema),
	family_position: S.optional(ActiveSchema),
	family_members: S.optional(S.Any),
	first_name: S.optional(ActiveSchema),
	last_name: S.optional(ActiveSchema),
	middle_name: S.optional(AllergiesSchema),
	legal_first_name: S.optional(AllergiesSchema),
	full_name: S.optional(ActiveSchema),
	salutation: S.optional(AllergiesSchema),
	suffix: S.optional(AllergiesSchema),
	image: S.optional(ImageSchema),
	login: S.optional(ActiveSchema),
	email: S.optional(ActiveSchema),
	allergies: S.optional(AllergiesSchema),
	confirmed_no_allergies: S.optional(ActiveSchema),
	addresses: S.optional(AddressesSchema),
	phones: S.optional(PhonesSchema),
	mobile_carrier: S.optional(CampusSchema),
	gender: S.optional(ActiveSchema),
	marital_status: S.optional(ActiveSchema),
	birthday: S.optional(AllergiesSchema),
	emergency_contact_name: S.optional(AllergiesSchema),
	anniversary: S.optional(AllergiesSchema),
	baptized: S.optional(ActiveSchema),
	limited_access_user: S.optional(ActiveSchema),
	deceased: S.optional(AllergiesSchema),
	membership_type: S.optional(CampusSchema),
	membership_date: S.optional(AllergiesSchema),
	membership_end: S.optional(AllergiesSchema),
	receive_email_from_church: S.optional(ActiveSchema),
	default_new_group_messages: S.optional(ActiveSchema),
	default_new_group_comments: S.optional(ActiveSchema),
	default_new_group_digest: S.optional(ActiveSchema),
	default_new_group_sms: S.optional(ActiveSchema),
	privacy_settings: S.optional(PrivacySettingsSchema),
	active: S.optional(ActiveSchema),
	creator: S.optional(CampusSchema),
	modifier: S.optional(CampusSchema),
	created: S.optional(CreatedSchema),
	modified: S.optional(CreatedSchema),
	user_defined_text_fields: S.optional(AllergiesSchema),
	user_defined_date_fields: S.optional(AllergiesSchema),
	user_defined_pulldown_fields: S.optional(AllergiesSchema),
});

export const ResponseSchema = S.Struct({
	individuals: S.optional(IndividualSchema),
});
export type Response = typeof ResponseSchema.Type;

export const CcbApiSchema = S.Struct({
	request: S.optional(S.Any),
	response: S.optional(ResponseSchema),
});
export type CcbApi = typeof CcbApiSchema.Type;

export const UserByEmailSchema = S.Struct({
	_declaration: S.optional(DeclarationSchema),
	ccb_api: S.optional(CcbApiSchema),
});
export type UserByEmail = typeof UserByEmailSchema.Type;
