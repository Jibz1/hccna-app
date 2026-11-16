import { StrapiStreamAclProvider } from "@/effect/services/StrapiStreamAclProvider";
import { sendCampusStreamNotification } from "@/effect/services/stream/notification";
import { StreamAuthorizationService } from "@/effect/services/StreamAuthorizationService";
import { StreamMappingService, streamSlugMapping } from "@/effect/services/StreamMappingService";
import { StreamProjectionStore } from "@/effect/services/StreamProjectionStore";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { type GraphQLContext } from "@/graphql/context";
import { CampusSlugSchema } from "@/utils/campuses";
import { patchCastrPlatformEffect } from "@/utils/castr";
import { type FirebaseCastrStream } from "@/utils/castr/index";
import {
	decodePlatformMetadataByPlatformId,
	isSamePlatformMetadata,
	parseRequestedPlatformMetadata,
	type PlatformMetadata,
} from "@/utils/castr/platformMetadata";
import { FIRST_INDEX } from "@/utils/constants";
import { omitUndefined } from "@/utils/omitUndefined";
import { CastrPatchError } from "@hccnj/castr";
import * as Sentry from "@sentry/bun";
import { Effect, Schema } from "effect";

interface StreamAccessResponse {
	castrStreamId: string;
	excludedPlatformIds: string[];
}

function filterAuthorizedPlatforms<T extends { id: string }>(
	platforms: readonly T[],
	excludedPlatformIds: string[],
): T[] {
	if (excludedPlatformIds.length === 0) {
		return [...platforms];
	}

	const excludedPlatformIdSet = new Set(excludedPlatformIds);

	return platforms.filter((platform) => !excludedPlatformIdSet.has(platform.id));
}

type FirebaseCastrPlatform = FirebaseCastrStream["platforms"][number];

interface SuccessfulCastrPlatformUpdate {
	platformId: string;
	enabled: boolean;
	key?: string;
}

interface CastrPlatformUpdate extends SuccessfulCastrPlatformUpdate {
	title: string;
	description: string;
	name: string;
	template: string;
	server: string;
}

/**
 * A destination Castr refused to update, kept to flat primitives: Sentry's
 * default normalizeDepth reduces Effect errors nested in `extra` to "[Object]".
 */
interface FailedCastrPlatformUpdate {
	platformId: string;
	name: string;
	template: string;
	enabled: boolean;
	error: string;
	status?: number;
	body?: string;
}

const isInstagramTemplate = (template: string | undefined) =>
	template?.trim().toLowerCase().includes("instagram") ?? false;

/**
 * Instagram issues a new stream key for every broadcast, so the saved key of
 * an Instagram destination that is off is spent: starting it needs a newly
 * pasted key.
 */
const requiresNewStreamKey = (platform: FirebaseCastrPlatform) =>
	isInstagramTemplate(platform.template) && !platform.enabled;

const describeFailedPlatformUpdate = (
	platform: CastrPlatformUpdate,
	error: Error,
): FailedCastrPlatformUpdate => {
	const patchError = error instanceof CastrPatchError ? error : undefined;
	return omitUndefined({
		platformId: platform.platformId,
		name: platform.name,
		template: platform.template,
		enabled: platform.enabled,
		error: error.message,
		status: patchError?.status,
		body: patchError?.body,
	});
};

const getBroadcastingStatusForEnabled = (
	enabled: boolean,
): FirebaseCastrPlatform["broadcasting_status"] => (enabled ? "online" : "offline");

function getLiveStatusAfterSuccessfulPlatformUpdates(
	stream: FirebaseCastrStream,
	updates: readonly SuccessfulCastrPlatformUpdate[],
): boolean {
	const updateByPlatformId = new Map(updates.map((update) => [update.platformId, update]));
	return stream.platforms.some((platform) => {
		const update = updateByPlatformId.get(platform.id);
		const enabled = update?.enabled ?? platform.enabled;
		const broadcastingStatus = update
			? getBroadcastingStatusForEnabled(update.enabled)
			: platform.broadcasting_status;

		return enabled || broadcastingStatus !== "offline";
	});
}

const validateUserAccessToStreamAndGetCastrStreamId = async (
	ctx: GraphQLContext,
	slug: string,
): Promise<StreamAccessResponse | undefined> => {
	if (!ctx.currentUserEmail) {
		return;
	}

	// CmsContent owns the Strapi queries, the special-slug mapping and decoding; the
	// ACL provider owns coordinator normalization and the error contract. Missing or
	// malformed records keep today's behavior of an undefined access response; source
	// failures keep propagating as errors.
	const record = await ctx.effect.runPromise(
		Effect.gen(function* () {
			const acl = yield* StrapiStreamAclProvider;
			return yield* acl.loadFreshBySlug(slug).pipe(
				Effect.catchTags({
					// oxlint-disable-next-line no-null
					StreamAclMissingStreamError: () => Effect.succeed(null),
					// oxlint-disable-next-line no-null
					StreamAclMalformedError: () => Effect.succeed(null),
				}),
			);
		}),
	);
	if (!record) {
		return;
	}

	const currentUserEmail = ctx.currentUserEmail.toLowerCase();
	const matchingCoordinators = record.coordinators.filter(
		(coordinator) => coordinator.normalizedEmail === currentUserEmail,
	);
	if (matchingCoordinators.length === 0) {
		return;
	}

	const excludedPlatformIds = new Set<string>();
	for (const coordinator of matchingCoordinators) {
		for (const platformId of coordinator.excludedPlatformIds) {
			excludedPlatformIds.add(platformId);
		}
	}

	return {
		castrStreamId: record.streamId,
		excludedPlatformIds: [...excludedPlatformIds],
	};
};

interface CastrPlatformType {
	id: string;
	name: string;
	enabled: boolean;
	template: string;
	broadcasting_status: "online" | "offline";
	channel_name: string;
	stream_key: string;
	requiresNewStreamKey: boolean;
	title: string | null;
	description: string | null;
}

type CastrStreamType = {
	name: string;
	enabled: boolean;
	id: string;
	broadcasting_status: "online" | "offline";
	title: string;
	description: string;
	platforms: CastrPlatformType[];
} & {
	castrPlayerUrl: string;
};

const CastrPlatformSchema = builder.objectRef<CastrPlatformType>("CastrPlatform").implement({
	fields: (t) => ({
		id: t.exposeID("id"),
		name: t.exposeString("name"),
		enabled: t.exposeBoolean("enabled"),
		template: t.exposeString("template"),
		broadcasting_status: t.exposeString("broadcasting_status"),
		channel_name: t.exposeString("channel_name"),
		stream_key: t.exposeString("stream_key"),
		requiresNewStreamKey: t.exposeBoolean("requiresNewStreamKey", {
			nullable: true,
			description:
				"True when switching this destination on needs a newly pasted stream key (Instagram issues a new key for every broadcast); a save without one skips it",
		}),
		title: t.exposeString("title", {
			nullable: true,
			description:
				"This destination's own title, or null when it uses the stream's shared title and description",
		}),
		description: t.exposeString("description", {
			nullable: true,
			description:
				"This destination's own description, or null when it uses the stream's shared title and description",
		}),
	}),
});
const CastrStreamSchema = builder.objectRef<CastrStreamType>("CastrStream").implement({
	fields: (t) => ({
		id: t.exposeID("id"),
		name: t.exposeString("name"),
		enabled: t.exposeBoolean("enabled"),
		broadcasting_status: t.exposeString("broadcasting_status"),
		title: t.exposeString("title"),
		description: t.exposeString("description"),
		platforms: t.field({
			type: [CastrPlatformSchema],
			resolve: (root) => root.platforms,
		}),
		castrPlayerUrl: t.exposeString("castrPlayerUrl", { nullable: true }),
	}),
});

const PingCastrStreamResponseSchema = builder
	.objectRef<{
		message: string;
		skippedPlatformIds?: readonly string[];
	}>("PingCastrStreamResponse")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message"),
			skippedPlatformIds: t.exposeIDList("skippedPlatformIds", {
				nullable: true,
				description: "Destinations this save skipped because they need a newly pasted stream key",
			}),
		}),
	});

interface PingCastrStreamSuccess {
	_tag: "PingCastrStreamSuccess";
	message: string;
}

interface PingCastrStreamQueueError {
	_tag: "PingCastrStreamQueueError";
	message: string;
}

type PingCastrStreamResultType = PingCastrStreamSuccess | PingCastrStreamQueueError;

const PingCastrStreamSuccessType = builder
	.objectRef<PingCastrStreamSuccess>("PingCastrStreamSuccess")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Success message",
			}),
		}),
	});

const PingCastrStreamQueueErrorType = builder
	.objectRef<PingCastrStreamQueueError>("PingCastrStreamQueueError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message when stream mapping update cannot be queued",
			}),
		}),
	});

const PingCastrStreamResult = builder.unionType("PingCastrStreamResult", {
	types: [PingCastrStreamSuccessType, PingCastrStreamQueueErrorType],
	resolveType: (value) => {
		switch (value._tag) {
			case "PingCastrStreamSuccess": {
				return PingCastrStreamSuccessType;
			}
			case "PingCastrStreamQueueError": {
				return PingCastrStreamQueueErrorType;
			}
		}
	},
});

const toPingCastrStreamQueueErrorMessage = (cause: unknown) =>
	cause instanceof Error ? cause.message : "Failed to queue stream mapping update";

const pingCastrStreamBackgroundUpdate = Effect.fn("GraphQL.pingCastrStream.backgroundUpdate")(
	function* () {
		const service = yield* StreamMappingService;
		yield* service.updateStreamMapping({ trigger: "cron" });
	},
	Effect.catchCause((cause) =>
		Effect.logError("Background stream mapping update failed").pipe(
			Effect.annotateLogs({
				operation: "pingCastrStream",
				cause: String(cause),
			}),
			Effect.asVoid,
		),
	),
);

const queuePingCastrStreamUpdate = Effect.fn("GraphQL.pingCastrStream.queueUpdate")(function* (
	ctx: GraphQLContext,
): Effect.fn.Return<PingCastrStreamResultType> {
	return yield* Effect.try({
		try: () => {
			void ctx.effect.runPromiseDetached(pingCastrStreamBackgroundUpdate());
			return {
				_tag: "PingCastrStreamSuccess" as const,
				message: "Stream mapping update queued",
			};
		},
		catch: (error) => ({
			_tag: "PingCastrStreamQueueError" as const,
			message: toPingCastrStreamQueueErrorMessage(error),
		}),
	}).pipe(
		Effect.matchEffect({
			onFailure: (error) => Effect.succeed(error),
			onSuccess: (success) => Effect.succeed(success),
		}),
	);
});

builder.queryFields((t) => ({
	castrStream: t.field({
		args: {
			campusSlug: t.arg.string({
				required: true,
				description: "The slug of the campus",
			}),
		},

		authScopes: authScope.signedIn,
		type: CastrStreamSchema,
		// Register subscriptions when query is executed
		resolve: async (_, { campusSlug }, ctx) => {
			if (!ctx.currentUserEmail) {
				return;
			}

			// Validate if the user is authorized to access the stream and get the castr stream id
			const streamAccess = await validateUserAccessToStreamAndGetCastrStreamId(ctx, campusSlug);
			if (!streamAccess?.castrStreamId) {
				return;
			}

			const castrStreamData = await ctx.effect.runPromise(
				Effect.gen(function* () {
					const store = yield* StreamProjectionStore;
					return yield* store.getStream(streamAccess.castrStreamId);
				}),
			);
			if (!castrStreamData) {
				return;
			}

			const visiblePlatforms = filterAuthorizedPlatforms(
				castrStreamData.platforms,
				streamAccess.excludedPlatformIds,
			);

			const platformMetadata = decodePlatformMetadataByPlatformId(castrStreamData);

			const castrPlayerUrl =
				streamSlugMapping[castrStreamData.id as keyof typeof streamSlugMapping]?.playerUrl;

			return {
				id: castrStreamData.id,
				name: castrStreamData.name,
				enabled: castrStreamData.enabled,
				broadcasting_status: castrStreamData.broadcasting_status,
				title: castrStreamData.title,
				description: castrStreamData.description,
				platforms: visiblePlatforms.map((platform) => ({
					id: platform.id,
					name: platform.name,
					enabled: platform.enabled,
					template: platform.template,
					broadcasting_status: platform.broadcasting_status,
					channel_name: castrStreamData.name,
					stream_key: platform.key,
					requiresNewStreamKey: requiresNewStreamKey(platform),
					// oxlint-disable-next-line no-null
					title: platformMetadata[platform.id]?.title ?? null,
					// oxlint-disable-next-line no-null
					description: platformMetadata[platform.id]?.description ?? null,
				})),
				castrPlayerUrl,
			};
		},
	}),
	// Endpoint Cloud scheduler will call this endpoint when polling for live streams from Castr
	// This does not wait for the update to complete, it will return immediately
	pingCastrStream: t.field({
		authScopes: authScope.googleInternal,
		type: PingCastrStreamResult,
		description: "Ping the castr stream to update the stream mapping",
		resolve: (_, __, ctx): Promise<PingCastrStreamResultType> => {
			if (!ctx.authType || ctx.authType !== "googleInternal") {
				return Promise.resolve({
					_tag: "PingCastrStreamQueueError",
					message: "Unauthorized",
				});
			}

			return ctx.effect.runPromise(queuePingCastrStreamUpdate(ctx));
		},
	}),
}));

const UpdateCastrStreamPlatformSchema = builder.inputType("UpdateCastrStreamPlatform", {
	fields: (t) => ({
		id: t.string({ required: true }),
		key: t.string({ description: "The key of the platform" }),
		title: t.string({
			description:
				"This destination's own title. Set with description; null clears both; omit to keep the saved values",
		}),
		description: t.string({
			description:
				"This destination's own description. Set with title; null clears both; omit to keep the saved values",
		}),
		broadcasting_status: t.field({
			type: builder.enumType("BroadcastingStatus", {
				values: ["online", "offline"] as const,
			}),
			required: true,
		}),
	}),
});

const UpdateCastrStreamInputSchema = builder.inputType("UpdateCastrStreamInput", {
	fields: (t) => ({
		title: t.string({ required: true }),
		description: t.string({ required: true }),
		campusSlug: t.string({ required: true }),
		streamId: t.string({ required: true }),
		platforms: t.field({
			type: [UpdateCastrStreamPlatformSchema],
			required: true,
		}),
	}),
});

builder.objectType(Error, {
	name: "Error",
	fields: (t) => ({
		message: t.exposeString("message"),
	}),
});

// oxlint-disable-next-line max-lines
builder.mutationFields((t) => ({
	updateCastrStream: t.field({
		authScopes: authScope.signedIn,
		args: {
			input: t.arg({
				type: UpdateCastrStreamInputSchema,
				required: true,
			}),
		},
		type: PingCastrStreamResponseSchema,
		resolve: async (_, { input: { campusSlug, streamId, ...rest } }, ctx) => {
			if (!ctx.currentUserEmail) {
				throw new Error("Unauthorized");
			}

			const requestedPlatformMetadata = new Map(
				rest.platforms.map((platform) => [platform.id, parseRequestedPlatformMetadata(platform)]),
			);

			// Projection-first ordering: the projected stream's platform list is an
			// authorization input (knownPlatformIds), so it loads before the grant.
			// The claimed streamId keys the read; a mismatch with the Strapi-owned
			// ID is rejected by the authorization service below, preserving the
			// existing "Castr stream not found" wire behavior in both orders.
			const castrStream = await ctx.effect.runPromise(
				Effect.gen(function* () {
					const store = yield* StreamProjectionStore;
					return yield* store.getStream(streamId);
				}),
			);
			if (!castrStream) {
				Sentry.captureException(new Error("Castr stream not found"));
				throw new Error("Castr stream not found");
			}

			// "Metadata changed" is a diff against the projected document, never
			// mere presence — title/description are required inputs on every
			// command (basis of Phase B change B2).
			const storedPlatformMetadata = decodePlatformMetadataByPlatformId(castrStream);
			const getNextPlatformMetadata = (platformId: string): PlatformMetadata | undefined => {
				const requested = requestedPlatformMetadata.get(platformId);
				return requested === undefined
					? storedPlatformMetadata[platformId]
					: (requested ?? undefined);
			};
			const changesMetadata =
				castrStream.title !== rest.title ||
				castrStream.description !== rest.description ||
				rest.platforms.some(
					(platform) =>
						!isSamePlatformMetadata(
							getNextPlatformMetadata(platform.id),
							storedPlatformMetadata[platform.id],
						),
				);

			const grantResult = await ctx.effect.runPromise(
				Effect.gen(function* () {
					const authorization = yield* StreamAuthorizationService;
					return yield* authorization
						.authorizeEdit({
							principalEmail: ctx.currentUserEmail ?? "",
							campusSlug,
							claimedStreamId: streamId,
							knownPlatformIds: castrStream.platforms.map((platform) => platform.id),
							requestedPlatformIds: rest.platforms.map((platform) => platform.id),
							changesMetadata,
						})
						.pipe(
							Effect.catchTag("StreamAuthorizationDeniedError", (error) =>
								Effect.succeed({ denied: error } as const),
							),
						);
				}),
			);
			if ("denied" in grantResult) {
				// Preserve the existing wire shape: every denial reads as a missing
				// stream, while Sentry keeps the more specific internal message for
				// the stream-mismatch case.
				Sentry.captureException(
					grantResult.denied.reason === "stream-mismatch"
						? new Error("Unauthorized Castr stream access")
						: new Error("Castr stream not found"),
				);
				throw new Error("Castr stream not found");
			}
			const grant = grantResult;

			const platformsToUpdate = rest.platforms.filter((platform) =>
				grant.allowedPlatformIds.has(platform.id),
			);

			if (rest.platforms.length > 0 && platformsToUpdate.length === 0) {
				Sentry.captureException(new Error("No authorized Castr channels to update"));
				throw new Error("No authorized Castr channels to update");
			}

			// A start that needs a new stream key but brings none (or the saved,
			// spent one) is skipped instead of being sent the dead key; the other
			// destinations still save.
			const isInstagramStartWithoutNewKey = (platform: (typeof platformsToUpdate)[number]) => {
				const castrPlatform = castrStream.platforms.find((p) => p.id === platform.id);
				return (
					castrPlatform !== undefined &&
					requiresNewStreamKey(castrPlatform) &&
					platform.broadcasting_status === "online" &&
					(!platform.key || platform.key === castrPlatform.key)
				);
			};
			const skippedInstagramStarts = platformsToUpdate.filter((platform) =>
				isInstagramStartWithoutNewKey(platform),
			);
			if (skippedInstagramStarts.length > FIRST_INDEX) {
				await ctx.effect.runPromise(
					Effect.logInfo("Instagram start skipped without a new stream key").pipe(
						Effect.annotateLogs({
							streamId: grant.streamId,
							platformIds: skippedInstagramStarts.map((platform) => platform.id),
							operation: "updateCastrStream",
						}),
					),
				);
			}

			// update platforms online status
			const streamUpdate = platformsToUpdate.flatMap((platform) => {
				if (isInstagramStartWithoutNewKey(platform)) {
					return [];
				}
				const castrPlatform = castrStream.platforms.find((p) => p.id === platform.id);

				const metadata = getNextPlatformMetadata(platform.id) ?? {
					title: rest.title,
					description: rest.description,
				};
				const update: CastrPlatformUpdate = {
					title: metadata.title,
					description: metadata.description,
					platformId: platform.id,
					enabled: platform.broadcasting_status === "online",
					name: castrPlatform?.name || "",
					template: castrPlatform?.template || "",
					server: castrPlatform?.server || "",
				};
				// Only a newly pasted key goes to a live Instagram destination; ending
				// it, or keeping it live, never resends the saved one.
				if (
					isInstagramTemplate(castrPlatform?.template) &&
					update.enabled &&
					platform.key &&
					platform.key !== castrPlatform?.key
				) {
					update.key = platform.key;
				}
				return [update];
			});
			const response = await Promise.allSettled(
				streamUpdate.map((platform) =>
					ctx.effect.runPromise(
						patchCastrPlatformEffect({
							streamId: grant.streamId,
							platformId: platform.platformId,
							data: omitUndefined({
								enabled: platform.enabled,
								//name: platform.name,
								key: platform?.key || undefined,
								//template: platform.template,
								//  server: platform.server,
								metadata: {
									title: platform.title,
									description: platform.description,
								},
							}),
						}),
					),
				),
			);
			const success = response
				.filter((result) => result.status === "fulfilled")
				.map((result) => result.value);
			const successfulPlatformUpdates: SuccessfulCastrPlatformUpdate[] = [];
			const failedPlatformUpdates: FailedCastrPlatformUpdate[] = [];
			// Only destinations Castr accepted and this request explicitly set or
			// cleared are recorded; the store applies them to the overrides saved at
			// write time, so concurrent saves to other destinations survive.
			const platformMetadataChanges = new Map<string, PlatformMetadata | null>();
			for (const [index, result] of response.entries()) {
				const platform = streamUpdate[index];
				if (result.status === "rejected" && platform) {
					const { reason } = result;
					const error = reason instanceof Error ? reason : new Error(String(reason));
					failedPlatformUpdates.push(describeFailedPlatformUpdate(platform, error));
				}
				if (result.status === "fulfilled" && platform) {
					const requested = requestedPlatformMetadata.get(platform.platformId);
					if (requested !== undefined) {
						platformMetadataChanges.set(platform.platformId, requested);
					}
					successfulPlatformUpdates.push(
						omitUndefined({
							platformId: platform.platformId,
							enabled: platform.enabled,
							key: platform.key || undefined,
						}),
					);
				}
			}

			if (failedPlatformUpdates.length > FIRST_INDEX) {
				await ctx.effect.runPromise(
					Effect.logError("Castr rejected destination updates").pipe(
						Effect.annotateLogs({
							streamId: grant.streamId,
							failedPlatformUpdates,
							operation: "updateCastrStream",
						}),
					),
				);
			}
			// A skipped Instagram start can leave nothing to send; the details still save.
			const onlySkippedInstagram =
				streamUpdate.length === FIRST_INDEX && skippedInstagramStarts.length > FIRST_INDEX;
			if (success.length === FIRST_INDEX && !onlySkippedInstagram) {
				throw new Error("Failed to update castr stream");
			}
			if (failedPlatformUpdates.length > FIRST_INDEX) {
				Sentry.captureException(
					new Error(
						`Partial Castr stream update failure: ${failedPlatformUpdates.length} platform(s) failed`,
					),
					{
						tags: {
							"castr.stream_id": grant.streamId,
							"castr.failed_templates": failedPlatformUpdates
								.map((failure) => failure.template)
								.join(","),
						},
						extra: { failedPlatformUpdates },
					},
				);
			}

			// update the stream doc
			// update castr metadata
			const isLive = getLiveStatusAfterSuccessfulPlatformUpdates(
				castrStream,
				successfulPlatformUpdates,
			);
			const { streamIsLive } = await ctx.effect.runPromise(
				Effect.gen(function* () {
					const store = yield* StreamProjectionStore;
					const campusDeliveryEnabled = ctx.statsig.checkGate(
						"campus_stream_notifications_enabled",
					);
					const saved = yield* store.updateStreamMetadata({
						streamId: grant.streamId,
						title: rest.title,
						description: rest.description,
						platformMetadataChanges,
						lastUpdated: new Date(),
						notificationCampusSlug:
							Schema.is(CampusSlugSchema)(campusSlug) &&
							(campusDeliveryEnabled || campusSlug === "house-of-stars")
								? campusSlug
								: undefined,
						platformEnabledChanges: new Map(
							successfulPlatformUpdates.map((update) => [update.platformId, update.enabled]),
						),
					});
					if (saved.notification) {
						yield* sendCampusStreamNotification(saved.notification, campusDeliveryEnabled);
					}
					return saved;
				}),
			);
			// A stop Castr accepted that leaves nothing on ends the stream, whatever else
			// the save tried to start. Turning off only the destinations this coordinator
			// manages, or a stop Castr rejected, leaves the stream on.
			const isEndingStream =
				!streamIsLive && successfulPlatformUpdates.some((update) => !update.enabled);

			const updateEffect = Effect.gen(function* () {
				const service = yield* StreamMappingService;
				yield* service.updateStreamMapping({
					trigger: "manual-mutation",
					isEndingStream,
					streamId: grant.streamId,
				});
			});

			await ctx.effect.runPromise(updateEffect);
			// Post-poll isLive override: deliberately runs AFTER the reconciliation
			// poll and overwrites its result for this stream, because Castr can
			// still report the stream as enabled while the user just ended it.
			await ctx.effect.runPromise(
				Effect.gen(function* () {
					const store = yield* StreamProjectionStore;
					yield* store.setLiveStatus({ streamId: grant.streamId, isLive });
				}),
			);

			return {
				message: "Castr stream updated",
				skippedPlatformIds: skippedInstagramStarts.map((platform) => platform.id),
			};
		},
	}),
}));
