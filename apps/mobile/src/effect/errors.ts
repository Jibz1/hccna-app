import { Schema } from "effect";

import { FirebaseUid, NonNegativeInt, TrimmedNonEmptyString } from "./schema";

export class RuntimeConfigMissingError extends Schema.TaggedError<RuntimeConfigMissingError>()(
  "RuntimeConfigMissingError",
  {
    key: TrimmedNonEmptyString,
    message: Schema.String,
  },
) {}

export class RuntimeConfigInvalidError extends Schema.TaggedError<RuntimeConfigInvalidError>()(
  "RuntimeConfigInvalidError",
  {
    key: TrimmedNonEmptyString,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class StorageEncryptionKeyMissingError extends Schema.TaggedError<StorageEncryptionKeyMissingError>()(
  "StorageEncryptionKeyMissingError",
  {
    id: TrimmedNonEmptyString,
    message: Schema.String,
  },
) {}

export class StorageClearEntryError extends Schema.TaggedError<StorageClearEntryError>()(
  "StorageClearEntryError",
  {
    id: TrimmedNonEmptyString,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class AppleSignInUnsupportedError extends Schema.TaggedError<AppleSignInUnsupportedError>()(
  "AppleSignInUnsupportedError",
  {
    platform: TrimmedNonEmptyString,
    message: Schema.String,
  },
) {}

export class ProviderTokenMissingError extends Schema.TaggedError<ProviderTokenMissingError>()(
  "ProviderTokenMissingError",
  {
    provider: TrimmedNonEmptyString,
    message: Schema.String,
  },
) {}

export class UnsupportedAuthProviderError extends Schema.TaggedError<UnsupportedAuthProviderError>()(
  "UnsupportedAuthProviderError",
  {
    provider: TrimmedNonEmptyString,
    message: Schema.String,
  },
) {}

export class AuthProviderOperationError extends Schema.TaggedError<AuthProviderOperationError>()(
  "AuthProviderOperationError",
  {
    provider: TrimmedNonEmptyString,
    operation: TrimmedNonEmptyString,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class AuthUserNotFoundError extends Schema.TaggedError<AuthUserNotFoundError>()(
  "AuthUserNotFoundError",
  {
    provider: Schema.optional(TrimmedNonEmptyString),
    message: Schema.String,
  },
) {}

export class UserDocumentTimeoutError extends Schema.TaggedError<UserDocumentTimeoutError>()(
  "UserDocumentTimeoutError",
  {
    uid: FirebaseUid,
    timeoutMs: Schema.Number,
    message: Schema.String,
  },
) {}

export class UserDocumentReadError extends Schema.TaggedError<UserDocumentReadError>()(
  "UserDocumentReadError",
  {
    uid: FirebaseUid,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class AuthSessionChangedError extends Schema.TaggedError<AuthSessionChangedError>()(
  "AuthSessionChangedError",
  {
    uid: FirebaseUid,
    message: Schema.String,
  },
) {}

export class AuthProfileNotReadyError extends Schema.TaggedError<AuthProfileNotReadyError>()(
  "AuthProfileNotReadyError",
  {
    uid: FirebaseUid,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class AccountDeletionSignOutError extends Schema.TaggedError<AccountDeletionSignOutError>()(
  "AccountDeletionSignOutError",
  {
    uid: FirebaseUid,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class AccountDeletionCleanupError extends Schema.TaggedError<AccountDeletionCleanupError>()(
  "AccountDeletionCleanupError",
  {
    uid: FirebaseUid,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class GraphQLRequestError extends Schema.TaggedError<GraphQLRequestError>()(
  "GraphQLRequestError",
  {
    operationName: TrimmedNonEmptyString,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class GraphQLParseError extends Schema.TaggedError<GraphQLParseError>()(
  "GraphQLParseError",
  {
    operationName: TrimmedNonEmptyString,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class GraphQLHttpResponseError extends Schema.TaggedError<GraphQLHttpResponseError>()(
  "GraphQLHttpResponseError",
  {
    operationName: TrimmedNonEmptyString,
    status: NonNegativeInt,
    retryAfterMs: Schema.optional(NonNegativeInt),
    message: Schema.String,
    result: Schema.optional(Schema.Unknown),
  },
) {}

export class GraphQLNotModifiedWithoutPayloadError extends Schema.TaggedError<GraphQLNotModifiedWithoutPayloadError>()(
  "GraphQLNotModifiedWithoutPayloadError",
  {
    operationName: TrimmedNonEmptyString,
    status: NonNegativeInt,
    message: Schema.String,
  },
) {}

export class GraphQLUnsupportedContentTypeError extends Schema.TaggedError<GraphQLUnsupportedContentTypeError>()(
  "GraphQLUnsupportedContentTypeError",
  {
    operationName: TrimmedNonEmptyString,
    contentType: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export class AppStartupGoogleSignInConfigError extends Schema.TaggedError<AppStartupGoogleSignInConfigError>()(
  "AppStartupGoogleSignInConfigError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class AppCheckInitializationError extends Schema.TaggedError<AppCheckInitializationError>()(
  "AppCheckInitializationError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const AppEffectError = Schema.Union([
  RuntimeConfigMissingError,
  RuntimeConfigInvalidError,
  StorageEncryptionKeyMissingError,
  StorageClearEntryError,
  AppleSignInUnsupportedError,
  ProviderTokenMissingError,
  UnsupportedAuthProviderError,
  AuthProviderOperationError,
  AuthUserNotFoundError,
  UserDocumentTimeoutError,
  UserDocumentReadError,
  AuthSessionChangedError,
  AuthProfileNotReadyError,
  AccountDeletionSignOutError,
  AccountDeletionCleanupError,
  GraphQLRequestError,
  GraphQLParseError,
  GraphQLHttpResponseError,
  GraphQLNotModifiedWithoutPayloadError,
  GraphQLUnsupportedContentTypeError,
  AppStartupGoogleSignInConfigError,
  AppCheckInitializationError,
]);
export type AppEffectError = typeof AppEffectError.Type;
