import { VodService } from "@/effect/services/VodService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { responseCache } from "@/graphql/responseCache";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { purgeStellateOperations } from "@/utils/stellate";
import { Effect } from "effect";

import { Scripture, type ScriptureData } from "./scripture";

import type { VodSetError } from "./vodErrors";

const VodFetchErrorType = builder
	.objectRef<{ _tag: "VodFetchError"; message: string }>("VodFetchError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message describing what went wrong",
			}),
		}),
	});

const VodNotFoundErrorType = builder
	.objectRef<{ _tag: "VodNotFoundError"; message: string }>("VodNotFoundError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message when verse is not found",
			}),
		}),
	});

const VodSetErrorType = builder
	.objectRef<{ _tag: "VodSetError"; message: string }>("VodSetError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message when setting verse fails",
			}),
		}),
	});

const VodPushNotificationErrorType = builder
	.objectRef<{
		_tag: "VodPushNotificationError";
		message: string;
	}>("VodPushNotificationError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message when push notification fails",
			}),
		}),
	});

const VodSuccessType = builder
	.objectRef<{ _tag: "VodSuccess"; message: string }>("VodSuccess")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Success message",
			}),
		}),
	});

type VerseOfTheDayResultType =
	| ScriptureData
	| { _tag: "VodFetchError"; message: string }
	| { _tag: "VodNotFoundError"; message: string };

const VerseOfTheDayResult = builder.unionType("VerseOfTheDayResult", {
	types: [Scripture, VodFetchErrorType, VodNotFoundErrorType],
	resolveType: (value) => {
		if ("_tag" in value) {
			switch (value._tag) {
				case "VodFetchError": {
					return VodFetchErrorType;
				}
				case "VodNotFoundError": {
					return VodNotFoundErrorType;
				}
			}
		}
		return Scripture;
	},
});

type SetVerseOfTheDayResultType =
	| { _tag: "VodSuccess"; message: string }
	| { _tag: "VodSetError"; message: string };

const VOD_RESPONSE_CACHE_ENTITIES = [{ typename: "Scripture" }] as const;
const VOD_STELLATE_OPERATION_NAMES = ["VerseOfTheDayQuery", "verseOfTheDayV2"] as const;

async function invalidateVodResponseCache(): Promise<void> {
	try {
		await responseCache.invalidate(VOD_RESPONSE_CACHE_ENTITIES);
	} catch (error) {
		getLogger().warn({ err: error }, "Failed to invalidate VOD response cache");
	}
}

async function purgeVodStellateCache(): Promise<void> {
	await purgeStellateOperations([...VOD_STELLATE_OPERATION_NAMES]);
}

const SetVerseOfTheDayResult = builder.unionType("SetVerseOfTheDayResultV2", {
	types: [VodSuccessType, VodSetErrorType],
	resolveType: (value) => {
		switch (value._tag) {
			case "VodSuccess": {
				return VodSuccessType;
			}
			case "VodSetError": {
				return VodSetErrorType;
			}
		}
	},
});

type VodPushNotificationResultType =
	| { _tag: "VodSuccess"; message: string }
	| { _tag: "VodFetchError"; message: string }
	| { _tag: "VodNotFoundError"; message: string }
	| { _tag: "VodPushNotificationError"; message: string };

const VodPushNotificationResult = builder.unionType("VodPushNotificationResult", {
	types: [VodSuccessType, VodFetchErrorType, VodNotFoundErrorType, VodPushNotificationErrorType],
	resolveType: (value) => {
		switch (value._tag) {
			case "VodSuccess": {
				return VodSuccessType;
			}
			case "VodFetchError": {
				return VodFetchErrorType;
			}
			case "VodNotFoundError": {
				return VodNotFoundErrorType;
			}
			case "VodPushNotificationError": {
				return VodPushNotificationErrorType;
			}
		}
	},
});

builder.queryField("verseOfTheDayV2", (t) =>
	t.field({
		type: VerseOfTheDayResult,
		authScopes: authScope.authorized,
		description: "Get the daily Bible verse with typed error handling",
		resolve: (_, __, ctx): Promise<VerseOfTheDayResultType> => {
			const program = VodService.use((vodService) => vodService.getDailyVerse).pipe(
				Effect.withSpan("GraphQL.verseOfTheDayV2"),
				Effect.catchTags({
					VodFetchError: (error: any) =>
						Effect.succeed({
							_tag: "VodFetchError" as const,
							message: error.message,
						}),
					VodNotFoundError: (error: any) =>
						Effect.succeed({
							_tag: "VodNotFoundError" as const,
							message: error.message,
						}),
				}),
			);

			return ctx.effect.runPromise(program);
		},
	}),
);

builder.mutationField("setVerseOfTheDay", (t) =>
	t.field({
		type: SetVerseOfTheDayResult,
		authScopes: authScope.googleInternal,
		description: "Set the daily Bible verse",
		resolve: async (_, __, ctx): Promise<SetVerseOfTheDayResultType> => {
			const program = Effect.gen(function* () {
				const vodService = yield* VodService;
				yield* vodService.setDailyVerse;
				return {
					_tag: "VodSuccess" as const,
					message: "Verse of the day set successfully",
				};
			}).pipe(
				Effect.withSpan("GraphQL.setVerseOfTheDayV2"),
				Effect.catchTag("VodSetError", (error: VodSetError) =>
					Effect.succeed({
						_tag: "VodSetError" as const,
						message: error.message,
					}),
				),
			);

			const result = await ctx.effect.runPromise(program);
			if (result._tag === "VodSuccess") {
				await invalidateVodResponseCache();
				await purgeVodStellateCache();
			}

			return result;
		},
	}),
);

builder.mutationField("vodPushNotification", (t) =>
	t.field({
		type: VodPushNotificationResult,
		authScopes: authScope.googleInternal,
		description: "Send a push notification for the daily Bible verse with typed error handling",
		resolve: (_, __, ctx): Promise<VodPushNotificationResultType> => {
			const program = Effect.gen(function* () {
				const vodService = yield* VodService;
				yield* vodService.sendPushNotification;
				return {
					_tag: "VodSuccess" as const,
					message: "Verse of the day push notification sent successfully",
				};
			}).pipe(
				Effect.withSpan("GraphQL.vodPushNotificationV2"),
				Effect.catchTags({
					VodFetchError: (error: any) =>
						Effect.succeed({
							_tag: "VodFetchError" as const,
							message: error.message,
						}),
					VodNotFoundError: (error: any) =>
						Effect.succeed({
							_tag: "VodNotFoundError" as const,
							message: error.message,
						}),
					VodPushNotificationError: (error: any) =>
						Effect.succeed({
							_tag: "VodPushNotificationError" as const,
							message: error.message,
						}),
				}),
			);
			return ctx.effect.runPromise(program);
		},
	}),
);
