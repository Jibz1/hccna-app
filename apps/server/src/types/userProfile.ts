import { Schema } from "effect";

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1));

const UserDepartmentSchema = Schema.Struct({
	id: Schema.Number,
	slug: Schema.String,
	ccbId: Schema.String,
	name: Schema.String,
	image: Schema.String,
	description: Schema.String,
	link: Schema.String,
	fullName: Schema.String,
});

// Stored `ministries` are not decoded: nothing reads them, and older entries lack `fullName`.
export const UserProfileDocSchema = Schema.Struct({
	email: Schema.String,
	uid: Schema.String,
	firstName: Schema.optional(Schema.String),
	lastName: Schema.optional(Schema.String),
	departments: Schema.optional(Schema.Array(UserDepartmentSchema)),
	ccbId: Schema.optional(Schema.String),
	ccbFamilyId: Schema.optional(Schema.String),
	img: Schema.optional(Schema.NullOr(Schema.String)),
	isVerified: Schema.Boolean,
	phone: Schema.optional(Schema.NullOr(Schema.String)),
	userMetadata: Schema.optional(Schema.Unknown),
	provider: Schema.optional(Schema.NullOr(Schema.String)),
	createdAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export const UserProfileDataSchema = Schema.Struct({
	email: UserProfileDocSchema.fields.email,
	uid: UserProfileDocSchema.fields.uid,
	firstName: NonEmptyStringSchema,
	lastName: NonEmptyStringSchema,
	departments: UserProfileDocSchema.fields.departments,
	ccbId: UserProfileDocSchema.fields.ccbId,
	ccbFamilyId: UserProfileDocSchema.fields.ccbFamilyId,
	img: NonEmptyStringSchema,
	isVerified: UserProfileDocSchema.fields.isVerified,
	phone: UserProfileDocSchema.fields.phone,
	userMetadata: UserProfileDocSchema.fields.userMetadata,
	provider: NonEmptyStringSchema,
	createdAt: UserProfileDocSchema.fields.createdAt,
});

export type UserProfileDoc = typeof UserProfileDocSchema.Type;
export type UserProfileData = typeof UserProfileDataSchema.Type;
