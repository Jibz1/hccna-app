import { Schema } from "effect";

export const TrimmedString = Schema.Trim;
export const TrimmedNonEmptyString = TrimmedString.check(Schema.isNonEmpty());

export const NonNegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);
export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const UuidString = Schema.String.check(Schema.isUUID());
export type UuidString = typeof UuidString.Type;

export const FirebaseUid = TrimmedNonEmptyString.pipe(
  Schema.brand("@HCCNA/FirebaseUid"),
);
export type FirebaseUid = typeof FirebaseUid.Type;

export const CampusId = TrimmedNonEmptyString.pipe(
  Schema.brand("@HCCNA/CampusId"),
);
export type CampusId = typeof CampusId.Type;

export const UserId = TrimmedNonEmptyString.pipe(Schema.brand("@HCCNA/UserId"));
export type UserId = typeof UserId.Type;

export const GraphQLRequestId = TrimmedNonEmptyString.pipe(
  Schema.brand("@HCCNA/GraphQLRequestId"),
);
export type GraphQLRequestId = typeof GraphQLRequestId.Type;
