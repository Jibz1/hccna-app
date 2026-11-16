import { AppConfig } from "@/effect/AppConfig";
import { StrapiStreamAclProvider } from "@/effect/services/StrapiStreamAclProvider";
import { Context, Effect, Layer, Schema } from "effect";

/**
 * StreamAuthorizationService — owns all resource-level and field-level stream
 * edit decisions (Phase A step 3 of docs/streaming-migration-implementation-v3.md).
 *
 * GraphQL keeps the coarse signed-in check; this service interprets coordinator
 * records, excluded platform IDs, stream-ID claims, and metadata permission.
 * The allowed platform set is derived from `knownPlatformIds` — the projected
 * stream's platforms, loaded by the caller BEFORE authorizing — minus the
 * matching coordinators' Strapi exclusions, matching the previous resolver
 * derivation from the Firestore document.
 *
 * The unauthorized-platform policy comes from AppConfig
 * (`STREAM_EDIT_UNAUTHORIZED_PLATFORM_POLICY`): "filter" preserves today's
 * silent narrowing; "reject" (Phase B change B1) fails the whole command when
 * any requested platform is outside the grant or metadata is changed without
 * permission.
 */

const DENIAL_REASONS = [
	"missing-identity",
	"missing-stream",
	"malformed-acl",
	"no-matching-coordinator",
	"stream-mismatch",
	"unauthorized-platforms",
	"metadata-denied",
] as const;

export class StreamAuthorizationDeniedError extends Schema.TaggedError<StreamAuthorizationDeniedError>()(
	"StreamAuthorizationDeniedError",
	{
		reason: Schema.Literals(DENIAL_REASONS),
		campusSlug: Schema.String,
		detail: Schema.optional(Schema.String),
	},
) {
	override get message() {
		return `Stream edit denied (${this.reason}) for slug ${this.campusSlug}`;
	}
}

export class StreamAuthorizationSourceError extends Schema.TaggedError<StreamAuthorizationSourceError>()(
	"StreamAuthorizationSourceError",
	{
		campusSlug: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Stream authorization source failed for slug ${this.campusSlug}`;
	}
}

export interface StreamEditGrant {
	readonly streamId: string;
	readonly allowedPlatformIds: ReadonlySet<string>;
	readonly canEditMetadata: boolean;
}

interface AuthorizeEditInput {
	readonly principalEmail: string;
	readonly campusSlug: string;
	readonly claimedStreamId: string;
	/** Platform IDs of the projected stream, loaded by the caller before authorizing. */
	readonly knownPlatformIds: readonly string[];
	readonly requestedPlatformIds: readonly string[];
	/** True only when the command's title/description DIFFER from the projected document. */
	readonly changesMetadata: boolean;
}

interface StreamAuthorizationServiceContract {
	authorizeEdit: (
		input: AuthorizeEditInput,
	) => Effect.Effect<
		StreamEditGrant,
		StreamAuthorizationDeniedError | StreamAuthorizationSourceError
	>;
}

export class StreamAuthorizationService extends Context.Service<
	StreamAuthorizationService,
	StreamAuthorizationServiceContract
>()("StreamAuthorizationService", {
	make: Effect.gen(function* () {
		const acl = yield* StrapiStreamAclProvider;
		const appConfig = yield* AppConfig;
		const policy = appConfig.streamEdit.unauthorizedPlatformPolicy;

		const authorizeEdit = Effect.fn("StreamAuthorizationService.authorizeEdit")(function* ({
			principalEmail,
			campusSlug,
			claimedStreamId,
			knownPlatformIds,
			requestedPlatformIds,
			changesMetadata,
		}: AuthorizeEditInput) {
			const normalizedPrincipal = principalEmail.trim().toLowerCase();
			if (!normalizedPrincipal) {
				return yield* Effect.fail(
					new StreamAuthorizationDeniedError({ reason: "missing-identity", campusSlug }),
				);
			}

			// Source-fresh, fail-closed: a coordinator removed in Strapi loses
			// command access as soon as Strapi serves the updated record.
			const record = yield* acl.loadFreshBySlug(campusSlug).pipe(
				Effect.catchTags({
					StreamAclMissingStreamError: () =>
						Effect.fail(
							new StreamAuthorizationDeniedError({ reason: "missing-stream", campusSlug }),
						),
					StreamAclMalformedError: (error) =>
						Effect.fail(
							new StreamAuthorizationDeniedError({
								reason: "malformed-acl",
								campusSlug,
								detail: error.detail,
							}),
						),
					StreamAclSourceError: (error) =>
						Effect.fail(new StreamAuthorizationSourceError({ campusSlug, cause: error.cause })),
				}),
			);

			const matchingCoordinators = record.coordinators.filter(
				(coordinator) => coordinator.normalizedEmail === normalizedPrincipal,
			);
			if (matchingCoordinators.length === 0) {
				return yield* Effect.fail(
					new StreamAuthorizationDeniedError({ reason: "no-matching-coordinator", campusSlug }),
				);
			}

			if (record.streamId !== claimedStreamId) {
				return yield* Effect.fail(
					new StreamAuthorizationDeniedError({ reason: "stream-mismatch", campusSlug }),
				);
			}

			const excludedPlatformIds = new Set(
				matchingCoordinators.flatMap((coordinator) => [...coordinator.excludedPlatformIds]),
			);
			const allowedPlatformIds: ReadonlySet<string> = new Set(
				knownPlatformIds.filter((platformId) => !excludedPlatformIds.has(platformId)),
			);
			const canEditMetadata = matchingCoordinators.some(
				(coordinator) => coordinator.canEditMetadata,
			);

			if (policy === "reject") {
				const unauthorizedRequested = requestedPlatformIds.filter(
					(platformId) => !allowedPlatformIds.has(platformId),
				);
				if (unauthorizedRequested.length > 0) {
					return yield* Effect.fail(
						new StreamAuthorizationDeniedError({
							reason: "unauthorized-platforms",
							campusSlug,
							detail: unauthorizedRequested.join(","),
						}),
					);
				}
				if (changesMetadata && !canEditMetadata) {
					return yield* Effect.fail(
						new StreamAuthorizationDeniedError({ reason: "metadata-denied", campusSlug }),
					);
				}
			}

			return {
				streamId: record.streamId,
				allowedPlatformIds,
				canEditMetadata,
			} satisfies StreamEditGrant;
		});

		return { authorizeEdit };
	}),
}) {}

export const StreamAuthorizationServiceLive = Layer.effect(
	StreamAuthorizationService,
	StreamAuthorizationService.make,
);
