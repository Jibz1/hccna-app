import { AppConfig } from "@/effect/AppConfig";
import {
	FirebaseAdminService,
	FirebaseAdminServiceLive,
} from "@/effect/services/FirebaseAdminService";
import { Context, Effect, Layer, Result, Schema } from "effect";

const DEFAULT_BUCKET_NAME = "app-hccnj";

class ExportStorageError extends Schema.TaggedError<ExportStorageError>()("ExportStorageError", {
	bucketName: Schema.String,
	objectPath: Schema.optional(Schema.String),
	operation: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `Export storage: ${this.operation} failed for bucket '${this.bucketName}'`;
	}
}

class ExportStorageConfigError extends Schema.TaggedError<ExportStorageConfigError>()(
	"ExportStorageConfigError",
	{
		detail: Schema.String,
	},
) {
	override get message() {
		return `Export storage: ${this.detail}`;
	}
}

class ExportStorageValidationError extends Schema.TaggedError<ExportStorageValidationError>()(
	"ExportStorageValidationError",
	{
		detail: Schema.String,
		issues: Schema.Array(Schema.String),
	},
) {
	override get message() {
		return `Export storage: ${this.detail}`;
	}
}

const NonEmptyTrimmedStringSchema = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));

const ExportUploadSchema = Schema.Struct({
	bucketName: Schema.optional(NonEmptyTrimmedStringSchema),
	cacheControl: Schema.optional(NonEmptyTrimmedStringSchema),
	contentType: NonEmptyTrimmedStringSchema,
	data: Schema.Union([Schema.instanceOf(Buffer), Schema.Uint8Array]),
	objectPath: NonEmptyTrimmedStringSchema,
});

type UploadExportFileInput = typeof ExportUploadSchema.Type;

interface ExportStorageServiceContract {
	readonly defaultBucketName: string;
	readonly downloadFile: (
		bucketName: string,
		objectPath: string,
	) => Effect.Effect<Buffer, ExportStorageError>;
	readonly doesFileExist: (
		bucketName: string,
		objectPath: string,
	) => Effect.Effect<boolean, ExportStorageError>;
	readonly uploadPrivateFile: (
		input: UploadExportFileInput,
	) => Effect.Effect<void, ExportStorageError | ExportStorageValidationError>;
}

const toExportStorageError =
	(operation: string, bucketName: string, objectPath?: string) => (cause: unknown) =>
		new ExportStorageError({
			bucketName,
			objectPath,
			operation,
			cause,
		});

function makeExportStorageServiceEffect(): Effect.Effect<
	ExportStorageServiceContract,
	ExportStorageConfigError,
	AppConfig | FirebaseAdminService
> {
	return Effect.gen(function* () {
		const appConfig = yield* AppConfig;
		const firebase = yield* FirebaseAdminService;
		const configuredBucketName =
			appConfig.integrations.gcsExportBucket?.trim() || DEFAULT_BUCKET_NAME;
		if (!configuredBucketName) {
			return yield* Effect.fail(
				new ExportStorageConfigError({
					detail: "GCS export bucket must be configured before ExportStorageService can start",
				}),
			);
		}
		const defaultBucketName = configuredBucketName;

		const resolveBucket = (bucketName = defaultBucketName) => firebase.getStorageBucket(bucketName);

		return {
			defaultBucketName,
			downloadFile: Effect.fn("ExportStorageService.downloadFile")(function* (
				bucketName: string,
				objectPath: string,
			) {
				return yield* Effect.tryPromise({
					try: async () => {
						const [data] = await resolveBucket(bucketName).file(objectPath).download();
						return data;
					},
					catch: toExportStorageError("downloadFile", bucketName, objectPath),
				});
			}),
			doesFileExist: Effect.fn("ExportStorageService.doesFileExist")(function* (
				bucketName: string,
				objectPath: string,
			) {
				return yield* Effect.tryPromise({
					try: async () => {
						const [exists] = await resolveBucket(bucketName).file(objectPath).exists();
						return exists;
					},
					catch: toExportStorageError("doesFileExist", bucketName, objectPath),
				});
			}),
			uploadPrivateFile: Effect.fn("ExportStorageService.uploadPrivateFile")(function* (
				input: UploadExportFileInput,
			) {
				const parsedInput = Schema.decodeUnknownResult(ExportUploadSchema)(input);
				if (Result.isFailure(parsedInput)) {
					return yield* Effect.fail(
						new ExportStorageValidationError({
							detail: "Invalid export upload payload",
							issues: [String(parsedInput.failure)],
						}),
					);
				}

				const {
					bucketName = defaultBucketName,
					cacheControl = "private,max-age=300",
					contentType,
					data,
					objectPath,
				} = parsedInput.success;

				return yield* Effect.tryPromise({
					try: async () => {
						const file = resolveBucket(bucketName).file(objectPath);
						await file.save(Buffer.from(data), {
							contentType,
							metadata: { cacheControl },
							resumable: false,
						});
						await file.makePrivate({ strict: false });
					},
					catch: toExportStorageError("uploadPrivateFile", bucketName, objectPath),
				});
			}),
		} satisfies ExportStorageServiceContract;
	});
}

export class ExportStorageService extends Context.Service<
	ExportStorageService,
	ExportStorageServiceContract
>()("ExportStorageService", {
	make: makeExportStorageServiceEffect(),
}) {}

export const ExportStorageServiceLive = Layer.effect(
	ExportStorageService,
	ExportStorageService.make,
).pipe(
	Layer.provide(FirebaseAdminServiceLive),
	Layer.provide(Layer.effect(AppConfig, AppConfig.make)),
);

export const makeExportStorageServiceLayer = () =>
	Layer.effect(ExportStorageService, makeExportStorageServiceEffect());
