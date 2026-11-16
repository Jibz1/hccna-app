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

export const TransactionsAttributesSchema = S.Struct({
	count: S.optional(S.String),
});
export type TransactionsAttributes = typeof TransactionsAttributesSchema.Type;

export const TransactionAttributesSchema = S.Struct({
	id: S.optional(S.String),
	merchant_transaction_id: S.optional(S.String),
});
export type TransactionAttributes = typeof TransactionAttributesSchema.Type;

export const CampusAttributesSchema = S.Struct({
	id: S.optional(S.String),
});
export type CampusAttributes = typeof CampusAttributesSchema.Type;

export const CheckNumberSchema = S.Struct({});
export type CheckNumber = typeof CheckNumberSchema.Type;

export const GroupingSchema = S.Struct({
	_attributes: S.optional(CampusAttributesSchema),
});
export type Grouping = typeof GroupingSchema.Type;

const IndividualReferenceSchema = S.Struct({
	_attributes: S.optional(CampusAttributesSchema),
	text: S.optional(S.String),
	id: S.optional(S.String),
});

export const DeclarationAttributesSchema = S.Struct({
	version: S.optional(S.String),
	encoding: S.optional(S.String),
});
export type DeclarationAttributes = typeof DeclarationAttributesSchema.Type;

export const ArgumentSchema = S.Struct({
	_attributes: S.optional(ArgumentAttributesSchema),
});
export type Argument = typeof ArgumentSchema.Type;

export const CampusSchema = S.Struct({
	_attributes: S.optional(CampusAttributesSchema),
	text: S.optional(S.String),
	id: S.optional(S.String),
});
export type Campus = typeof CampusSchema.Type;

export const TransactionDetailSchema = S.Struct({
	_attributes: S.optional(CampusAttributesSchema),
	coa: S.optional(CampusSchema),
	amount: S.optional(S.Union([AvailabilitySchema, S.Number])),
	tax_deductible: S.optional(S.Union([AvailabilitySchema, S.Boolean])),
	note: S.optional(S.Union([CheckNumberSchema, S.String])),
	creator: S.optional(S.Union([CampusSchema, S.String])),
	modifier: S.optional(S.Union([CampusSchema, S.String])),
	created: S.optional(S.Union([AvailabilitySchema, S.String])),
	modified: S.optional(S.Union([AvailabilitySchema, S.String])),
});
export type TransactionDetail = typeof TransactionDetailSchema.Type;

export const DeclarationSchema = S.Struct({
	_attributes: S.optional(DeclarationAttributesSchema),
});
export type Declaration = typeof DeclarationSchema.Type;

export const ParametersSchema = S.Struct({
	argument: S.optional(S.Array(ArgumentSchema)),
});
export type Parameters = typeof ParametersSchema.Type;

export const TransactionDetailsSchema = S.Struct({
	transaction_detail: S.optional(S.Any),
});
export type TransactionDetails = typeof TransactionDetailsSchema.Type;

export const RequestSchema = S.Struct({
	parameters: S.optional(ParametersSchema),
});
export type Request = typeof RequestSchema.Type;

export const TransactionSchema = S.Struct({
	_attributes: S.optional(TransactionAttributesSchema),
	campus: S.optional(S.Any),
	individual: S.optional(IndividualReferenceSchema),
	date: S.String,
	grouping: S.optional(GroupingSchema),
	payment_type: S.optional(S.Union([AvailabilitySchema, S.String])),
	check_number: S.optional(S.Union([CheckNumberSchema, S.String, S.Number])),
	transaction_details: S.optional(TransactionDetailsSchema),
	creator: S.optional(CampusSchema),
	modifier: S.optional(CampusSchema),
	created: S.optional(S.Union([AvailabilitySchema, S.String])),
	modified: S.optional(S.Union([AvailabilitySchema, S.String])),
	merchant_name: S.optional(S.Union([CheckNumberSchema, S.String])),
	merchant_individual_id: S.optional(S.Union([CheckNumberSchema, S.String])),
});
export type Transaction = typeof TransactionSchema.Type;

const TransactionCollectionSchema = S.Union([S.Array(TransactionSchema), TransactionSchema]);

export const TransactionsSchema = S.Struct({
	_attributes: S.optional(TransactionsAttributesSchema),
	transaction: S.optional(TransactionCollectionSchema),
});
export type Transactions = typeof TransactionsSchema.Type;

export const ResponseSchema = S.Struct({
	service: S.optional(S.Union([AvailabilitySchema, S.String])),
	service_action: S.optional(S.Union([AvailabilitySchema, S.String])),
	availability: S.optional(S.Union([AvailabilitySchema, S.String])),
	transactions: S.optional(TransactionsSchema),
});
export type Response = typeof ResponseSchema.Type;

export const CcbApiSchema = S.Struct({
	request: S.optional(RequestSchema),
	response: S.optional(ResponseSchema),
});
export type CcbApi = typeof CcbApiSchema.Type;

export const GivingSchema = S.Struct({
	_declaration: S.optional(DeclarationSchema),
	ccb_api: S.optional(CcbApiSchema),
});
export type Giving = typeof GivingSchema.Type;
