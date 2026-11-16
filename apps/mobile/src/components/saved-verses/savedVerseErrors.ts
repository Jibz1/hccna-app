import { Option, Schema } from "effect";

// Relay rejects a mutation whose non-null field failed and keeps the GraphQL errors on `source`.
const RelayGraphQLFailure = Schema.Struct({
  source: Schema.Struct({
    errors: Schema.Array(
      Schema.Struct({
        extensions: Schema.optional(
          Schema.Struct({
            code: Schema.optional(Schema.String),
            reason: Schema.optional(Schema.String),
          }),
        ),
      }),
    ),
  }),
});
const decodeFailure = Schema.decodeUnknownOption(RelayGraphQLFailure);

const MESSAGES = new Map([
  [
    "SAVED_VERSE_LIMIT",
    "You've saved the most verses you can save. Remove one to save another.",
  ],
  ["SCRIPTURE_NOT_FOUND", "This verse can't be saved right now."],
  [
    "PROFILE_UNAVAILABLE",
    "Your account is still being set up. Try again in a moment.",
  ],
  ["UNAUTHENTICATED", "Sign in to save verses."],
]);

export function savedVerseErrorMessage(
  error: Error,
  action: "save" | "remove",
): string {
  const extensions = Option.match(decodeFailure(error), {
    onNone: () => [],
    onSome: (failure) => failure.source.errors.map((item) => item.extensions),
  });
  const message = extensions
    .flatMap((extension) => [extension?.reason, extension?.code])
    .map((key) => (key === undefined ? undefined : MESSAGES.get(key)))
    .find((text) => text !== undefined);
  return (
    message ??
    `Couldn't ${action} this verse. Check your connection and try again.`
  );
}
