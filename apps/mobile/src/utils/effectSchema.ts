import { Schema } from "effect";

export const EmailString = Schema.String.check(
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: "Invalid email address",
  }),
);

export const DateFromStringOrDate = Schema.Union([
  Schema.Date,
  Schema.DateFromString,
]);

export const nullableOptional = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.NullOr(schema));
