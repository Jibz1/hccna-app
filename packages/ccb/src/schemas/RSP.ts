import { Schema as S } from "effect";

// === Effect schemas (all fields optional, empty tags → string) ===

// request.parameters.argument
const ArgumentSchema = S.Struct({
	name: S.optional(S.String),
	value: S.optional(S.String),
});

// request.parameters
const ParametersSchema = S.Struct({
	argument: S.optional(S.Array(ArgumentSchema)),
});

// request
const RequestSchema = S.Struct({ parameters: S.optional(ParametersSchema) });

// generic { id?, text? } container for elements with both an attribute and text
const IdTextSchema = S.Struct({
	id: S.optional(S.String),
	text: S.optional(S.String),
});

const CountrySchema = S.Struct({
	code: S.optional(S.String),
	text: S.optional(S.String),
});

// response.privacy_settings
const PrivacySettingsSchema = S.Struct({
	profile_listed: S.optional(S.Boolean),
	mailing_address: S.optional(IdTextSchema),
	home_address: S.optional(IdTextSchema),
	contact_phone: S.optional(IdTextSchema),
	home_phone: S.optional(IdTextSchema),
	work_phone: S.optional(IdTextSchema),
	mobile_phone: S.optional(IdTextSchema),
	emergency_phone: S.optional(IdTextSchema),
	birthday: S.optional(IdTextSchema),
	anniversary: S.optional(IdTextSchema),
	gender: S.optional(IdTextSchema),
	marital_status: S.optional(IdTextSchema),
	user_defined_fields: S.optional(IdTextSchema),
	allergies: S.optional(IdTextSchema),
});

// addresses.address
const AddressSchema = S.Struct({
	type: S.optional(S.String),
	street_address: S.optional(S.String),
	city: S.optional(S.String),
	state: S.optional(S.String),
	zip: S.optional(S.Union([S.String, S.Null, S.Number])),
	country: S.optional(CountrySchema),
	line_1: S.optional(S.String),
	line_2: S.optional(S.String),
	latitude: S.optional(S.Union([S.String, S.Null, S.Number])),
	longitude: S.optional(S.Union([S.String, S.Null, S.Number])),
});

// addresses
const AddressesSchema = S.Struct({
	address: S.optional(S.Array(AddressSchema)),
});

// phones.phone
const PhoneSchema = S.Struct({
	type: S.optional(S.String),
	text: S.optional(S.String),
});

// phones
const PhonesSchema = S.Struct({
	phone: S.optional(S.Array(PhoneSchema)),
});

// individual
const IndividualSchema = S.Struct({
	id: S.optional(S.String),
	sync_id: S.optional(S.String),
	other_id: S.optional(S.String),
	giving_number: S.optional(S.String),
	campus: S.optional(IdTextSchema),
	family: S.optional(IdTextSchema),
	family_image: S.optional(S.String),
	family_position: S.optional(S.String),
	family_members: S.optional(S.Any),
	first_name: S.optional(S.String),
	last_name: S.optional(S.String),
	middle_name: S.optional(S.String),
	legal_first_name: S.optional(S.String),
	full_name: S.optional(S.String),
	salutation: S.optional(S.String),
	suffix: S.optional(S.String),
	image: S.optional(S.String),
	login: S.optional(S.String),
	email: S.optional(S.String),
	allergies: S.optional(S.String),
	confirmed_no_allergies: S.optional(S.Boolean),
	addresses: S.optional(AddressesSchema),
	phones: S.optional(PhonesSchema),
	mobile_carrier: S.optional(IdTextSchema),
	gender: S.optional(S.String),
	marital_status: S.optional(S.String),
	birthday: S.optional(S.String),
	emergency_contact_name: S.optional(S.String),
	anniversary: S.optional(S.String),
	baptized: S.optional(S.Boolean),
	limited_access_user: S.optional(S.Boolean),
	deceased: S.optional(S.String),
	membership_type: S.optional(IdTextSchema),
	membership_date: S.optional(S.String),
	membership_end: S.optional(S.String),
	receive_email_from_church: S.optional(S.Boolean),
	default_new_group_messages: S.optional(S.String),
	default_new_group_comments: S.optional(S.String),
	default_new_group_digest: S.optional(S.String),
	default_new_group_sms: S.optional(S.String),
	privacy_settings: S.optional(PrivacySettingsSchema),
	active: S.optional(S.Boolean),
	creator: S.optional(IdTextSchema),
	modifier: S.optional(IdTextSchema),
	created: S.optional(S.String),
	modified: S.optional(S.String),
	user_defined_text_fields: S.optional(S.String),
	user_defined_date_fields: S.optional(S.String),
	user_defined_pulldown_fields: S.optional(S.String),
});

const IndividualCollectionSchema = S.Union([IndividualSchema, S.Null, S.Array(IndividualSchema)]);

// individuals (with count attr)
const IndividualsSchema = S.Struct({
	count: S.optional(S.String),
	individual: S.optional(IndividualCollectionSchema),
});

// response
export const ResponseSchema = S.Struct({
	service: S.optional(S.String),
	service_action: S.optional(S.String),
	availability: S.optional(S.String),
	individuals: S.optional(IndividualsSchema),
});
export type Response = typeof ResponseSchema.Type;

// root
export const CcbApiSchemaRsp = S.Struct({
	request: S.optional(RequestSchema),
	response: S.optional(ResponseSchema),
});
