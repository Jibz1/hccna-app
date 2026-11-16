import { RedisService } from "@/effect/RedisService";
import { serviceRequest } from "@/utils/serviceRequest";
// oxlint-disable max-statements
import {
	buildCCBUrl,
	CCBRequestType,
	createCCBClient,
	DefaultCCBCacheConfig,
	type AddUserToGroupResponse,
	type AttendanceProfileResponse,
	type CCBError,
	type CCBFetchError,
	type CCBFetchFn,
	type CCBParams,
	type CCBParseError,
	type CCBResponse,
	type CreateEventAttendanceInput,
	type GivingResponse,
	type GroupParticipantsResponse,
	type GroupsResponse,
	type RemoveUserFromGroupResponse,
	type SearchUserByEmailResponse,
	type UserGroupsByIdResponse,
} from "@hccnj/ccb";
import { Config, Context, DateTime, Duration, Effect, Layer, Redacted } from "effect";
import { LRUCache } from "lru-cache";

// Re-export types from @hccnj/ccb for backward compatibility
export { CCBParseError } from "@hccnj/ccb";

const ccbConfig = Config.all({
	username: Config.String("CCB_USERNAME"),
	password: Config.Redacted("CCB_PASSWORD"),
	apiEndpoint: Config.String("CCB_API_END_POINT"),
});

interface CachedCCBEntry<T> {
	data: T;
	cachedAt: number;
}

const LRU_CACHE_MAX_SIZE = 2000;

const isStale = <T>(entry: CachedCCBEntry<T>, ttlSeconds: number, now: number): boolean => {
	const ageSeconds = (now - entry.cachedAt) / 1000;
	return ageSeconds > ttlSeconds;
};

/**
 * Extract the CCB action name for metrics and logs, from a full URL or a bare `srv=…` query.
 */
const extractAction = (url: string): string => {
	const match = url.match(/(?:^|[?&])srv=(?<action>[^&]+)/u);
	return match?.groups?.action ?? "unknown";
};

type CCBGetError = CCBFetchError | CCBParseError;

interface CCBServiceContract {
	get: <T extends CCBRequestType>(args: {
		url: string;
		type: T;
	}) => Effect.Effect<CCBResponse<T>, CCBGetError>;
	request: <T extends CCBRequestType>(
		type: T,
		params: CCBParams[T],
		options?: { readonly skipCache?: boolean },
	) => Effect.Effect<CCBResponse<T>, CCBGetError>;
	post: <TOut = unknown>(args: {
		endpoint: string;
		jsonData: object;
	}) => Effect.Effect<TOut, CCBError>;
	clearLRU: () => void;
	searchUserByEmail: (
		email: string,
		options?: { readonly skipCache?: boolean },
	) => Effect.Effect<SearchUserByEmailResponse, CCBGetError>;
	getUserGroupsById: (
		individualId: number,
		options?: { readonly skipCache?: boolean },
	) => Effect.Effect<UserGroupsByIdResponse, CCBGetError>;
	getGroups: (modifiedSince?: string) => Effect.Effect<GroupsResponse, CCBGetError>;
	addUserToGroup: (params: {
		individualId: number;
		groupId: number;
		isPending?: boolean;
	}) => Effect.Effect<AddUserToGroupResponse, CCBGetError>;
	removeUserFromGroup: (params: {
		individualId: number;
		groupId: number;
	}) => Effect.Effect<RemoveUserFromGroupResponse, CCBGetError>;
	getGroupParticipants: (groupId: number) => Effect.Effect<GroupParticipantsResponse, CCBGetError>;
	/** `skipCache` reads CCB directly, for callers that keep their own cache of the result. */
	getGiving: (
		familyId: string,
		year?: number,
		options?: { readonly skipCache?: boolean },
	) => Effect.Effect<GivingResponse, CCBGetError>;
	getAttendanceProfile: (
		eventId: number,
		occurrence: string,
	) => Effect.Effect<AttendanceProfileResponse, CCBGetError>;
	createEventAttendance: (input: CreateEventAttendanceInput) => Effect.Effect<unknown, CCBError>;
}

export class CCBService extends Context.Service<CCBService, CCBServiceContract>()("CCBService", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;

		const { username, password: passwordRedacted, apiEndpoint } = yield* ccbConfig;
		const password = Redacted.value(passwordRedacted);

		// Wrap serviceRequest as a generic fetch function for the CCB client
		const httpFetch: CCBFetchFn = (url, options) =>
			serviceRequest({
				url,
				options,
				service: "ccb",
				action: extractAction(url),
			});

		const client = createCCBClient({ apiEndpoint, username, password }, httpFetch);

		const CACHE_PREFIX = "ccb-service";

		const getCacheKey = (url: string) => `${CACHE_PREFIX}:${url}`;
		const lruCache = new LRUCache<string, CachedCCBEntry<unknown>>({
			max: LRU_CACHE_MAX_SIZE,
			allowStale: true,
			allowStaleOnFetchAbort: true,
			allowStaleOnFetchRejection: true,
			noDeleteOnStaleGet: true,
		});

		const getFromRedis = <T>(url: string): Effect.Effect<CachedCCBEntry<T> | null, never> =>
			Effect.fn("CCBService.getFromRedis")(function* () {
				const startTime = DateTime.toEpochMillis(yield* DateTime.now);
				const cacheKey = getCacheKey(url);

				const value = yield* redis.get(cacheKey).pipe(
					// oxlint-disable-next-line no-null
					Effect.catchTag("RedisError", () => Effect.succeed(null)),
				);

				const now = DateTime.toEpochMillis(yield* DateTime.now);
				const durationMs = now - startTime;

				if (!value) {
					yield* Effect.logInfo("CCB Redis cache miss").pipe(
						Effect.annotateLogs({ cacheKey, durationMs }),
					);
					// oxlint-disable-next-line no-null
					return null;
				}

				try {
					const entry = JSON.parse(value) as CachedCCBEntry<T>;
					const ageMs = now - entry.cachedAt;
					yield* Effect.logInfo("CCB Redis cache hit").pipe(
						Effect.annotateLogs({ cacheKey, durationMs, cacheAgeMs: ageMs }),
					);
					return entry;
				} catch {
					yield* Effect.logWarning("CCB Redis cache parse error").pipe(
						Effect.annotateLogs({ cacheKey, durationMs }),
					);
					// oxlint-disable-next-line no-null
					return null;
				}
			})();

		const setToRedis = <T>(url: string, data: T, ttlSeconds: number) =>
			Effect.fn("CCBService.setToRedis")(function* () {
				const startTime = DateTime.toEpochMillis(yield* DateTime.now);
				const cacheKey = getCacheKey(url);
				const cachedAt = DateTime.toEpochMillis(yield* DateTime.now);
				const entry: CachedCCBEntry<T> = {
					data,
					cachedAt,
				};

				yield* redis
					.setex(cacheKey, ttlSeconds, JSON.stringify(entry))
					.pipe(Effect.catchTag("RedisError", () => Effect.void));

				const durationMs = DateTime.toEpochMillis(yield* DateTime.now) - startTime;
				yield* Effect.logDebug("CCB cache set").pipe(
					Effect.annotateLogs({ cacheKey, ttlSeconds, durationMs }),
				);
			})();

		const getFromLRU = <T>(url: string): CachedCCBEntry<T> | undefined => {
			const cacheKey = getCacheKey(url);
			return lruCache.get(cacheKey) as CachedCCBEntry<T> | undefined;
		};

		const setToLRU = <T>(url: string, data: T): Effect.Effect<void> =>
			Effect.gen(function* () {
				const cacheKey = getCacheKey(url);
				const entry: CachedCCBEntry<T> = {
					data,
					cachedAt: DateTime.toEpochMillis(yield* DateTime.now),
				};
				lruCache.set(cacheKey, entry);
			});

		const setBothCaches = <T>(
			url: string,
			data: T,
			ttlSeconds: number,
		): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				yield* setToLRU(url, data);
				yield* setToRedis(url, data, ttlSeconds);
			});

		const fetchGetUnknown = (
			url: string,
			type: CCBRequestType,
		): Effect.Effect<unknown, CCBGetError> => client.fetchGet(url, type as never);

		const getUnknown = (args: {
			url: string;
			type: CCBRequestType;
			skipCache?: boolean;
		}): Effect.Effect<unknown, CCBGetError> => {
			const { url, type, skipCache = false } = args;
			const cacheConfig = skipCache ? undefined : DefaultCCBCacheConfig[type];

			if (!cacheConfig) {
				return fetchGetUnknown(url, type).pipe(
					Effect.tapError((error) =>
						Effect.logError("CCB GET error").pipe(
							Effect.annotateLogs({
								error: String(error.message),
								type,
								action: extractAction(url),
							}),
						),
					),
				);
			}

			const ttlSeconds = Math.floor(Duration.toMillis(cacheConfig.ttl) / 1000);

			return Effect.gen(function* () {
				const startTime = DateTime.toEpochMillis(yield* DateTime.now);
				const cacheKey = getCacheKey(url);

				const lruEntry = getFromLRU<unknown>(url);
				if (lruEntry) {
					const now = DateTime.toEpochMillis(yield* DateTime.now);
					yield* Effect.logInfo("CCB LRU cache hit").pipe(
						Effect.annotateLogs({ cacheKey, cacheSize: lruCache.size }),
					);
					const cacheAgeMs = now - lruEntry.cachedAt;
					const isStaleEntry = isStale(lruEntry, ttlSeconds, now);

					if (isStaleEntry) {
						yield* Effect.logInfo("CCB serving stale LRU data, refreshing in background").pipe(
							Effect.annotateLogs({
								type,
								url,
								cacheAgeMs,
								ttlSeconds,
								cacheLayer: "lru",
							}),
						);
						yield* Effect.forkDetach(
							fetchGetUnknown(url, type).pipe(
								Effect.flatMap((data) => setBothCaches(url, data, ttlSeconds)),
								Effect.catchTags({
									CCBFetchError: (error) =>
										Effect.logWarning("CCB background refresh failed").pipe(
											Effect.annotateLogs({
												type,
												url,
												error: error.message,
											}),
											Effect.asVoid,
										),
									CCBParseError: (error) =>
										Effect.logWarning("CCB background refresh failed").pipe(
											Effect.annotateLogs({
												type,
												url,
												error: error.message,
											}),
											Effect.asVoid,
										),
								}),
							),
						);
					} else {
						yield* Effect.logDebug("CCB serving fresh LRU cached data").pipe(
							Effect.annotateLogs({
								type,
								url,
								cacheAgeMs,
								totalDurationMs: now - startTime,
								cacheLayer: "lru",
							}),
						);
					}
					return lruEntry.data;
				}

				yield* Effect.logInfo("CCB LRU cache miss").pipe(
					Effect.annotateLogs({ cacheKey, cacheSize: lruCache.size }),
				);

				const redisEntry = yield* getFromRedis<unknown>(url);
				if (redisEntry) {
					yield* setToLRU(url, redisEntry.data);

					const now = DateTime.toEpochMillis(yield* DateTime.now);
					const cacheAgeMs = now - redisEntry.cachedAt;
					const isStaleEntry = isStale(redisEntry, ttlSeconds, now);

					if (isStaleEntry) {
						yield* Effect.logInfo("CCB serving stale Redis data, refreshing in background").pipe(
							Effect.annotateLogs({
								type,
								url,
								cacheAgeMs,
								ttlSeconds,
								cacheLayer: "redis",
							}),
						);
						yield* Effect.forkDetach(
							fetchGetUnknown(url, type).pipe(
								Effect.flatMap((data) => setBothCaches(url, data, ttlSeconds)),
								Effect.catchTags({
									CCBFetchError: (error) =>
										Effect.logWarning("CCB background refresh failed").pipe(
											Effect.annotateLogs({
												type,
												url,
												error: error.message,
											}),
											Effect.asVoid,
										),
									CCBParseError: (error) =>
										Effect.logWarning("CCB background refresh failed").pipe(
											Effect.annotateLogs({
												type,
												url,
												error: error.message,
											}),
											Effect.asVoid,
										),
								}),
							),
						);
					} else {
						yield* Effect.logDebug("CCB serving fresh Redis cached data").pipe(
							Effect.annotateLogs({
								type,
								url,
								cacheAgeMs,
								totalDurationMs: now - startTime,
								cacheLayer: "redis",
							}),
						);
					}
					return redisEntry.data;
				}

				const freshData = yield* fetchGetUnknown(url, type);
				yield* setToLRU(url, freshData);
				yield* Effect.forkDetach(
					setToRedis(url, freshData, ttlSeconds).pipe(
						Effect.catch((error) =>
							Effect.logWarning("CCBService: Background Redis write failed").pipe(
								Effect.annotateLogs({ url, error: String(error) }),
								Effect.asVoid,
							),
						),
					),
				);

				return freshData;
			}).pipe(
				Effect.withSpan("CCBService.get"),
				Effect.tapError((error) =>
					Effect.logError("CCB GET error").pipe(
						Effect.annotateLogs({
							error: String(error),
							type,
							action: extractAction(url),
						}),
					),
				),
			);
		};
		const get: CCBServiceContract["get"] = (args) =>
			getUnknown(args) as Effect.Effect<CCBResponse<typeof args.type>, CCBGetError>;

		const post = <TOut = unknown>(args: {
			endpoint: string;
			jsonData: object;
		}): Effect.Effect<TOut, CCBError> =>
			client.fetchPost<TOut>(args.endpoint, args.jsonData).pipe(
				Effect.tapError((error) =>
					Effect.logError("CCB POST error").pipe(
						Effect.annotateLogs({
							error: String(error),
							endpoint: args.endpoint,
						}),
					),
				),
			);

		const request = <T extends CCBRequestType>(
			type: T,
			params: CCBParams[T],
			options?: { readonly skipCache?: boolean },
		): Effect.Effect<CCBResponse<T>, CCBGetError> => {
			const url = buildCCBUrl(type, params);
			return getUnknown({ url, type, skipCache: options?.skipCache ?? false }) as Effect.Effect<
				CCBResponse<T>,
				CCBGetError
			>;
		};

		const clearLRU = (): void => {
			lruCache.clear();
		};
		const requestUnknown = request;

		return {
			get,
			request,
			post,
			clearLRU,

			searchUserByEmail: (email, options): Effect.Effect<SearchUserByEmailResponse, CCBGetError> =>
				requestUnknown(CCBRequestType.SEARCH_USER_BY_EMAIL, { email }, options),

			getUserGroupsById: (
				individualId,
				options,
			): Effect.Effect<UserGroupsByIdResponse, CCBGetError> =>
				requestUnknown(CCBRequestType.GET_USER_GROUPS_BY_ID, { individualId }, options),

			getGroups: (modifiedSince?: string): Effect.Effect<GroupsResponse, CCBGetError> =>
				requestUnknown(
					CCBRequestType.GET_GROUPS,
					modifiedSince ? { modifiedSince } : {},
				) as Effect.Effect<GroupsResponse, CCBGetError>,

			addUserToGroup: (params: {
				individualId: number;
				groupId: number;
				isPending?: boolean;
			}): Effect.Effect<AddUserToGroupResponse, CCBGetError> =>
				requestUnknown(CCBRequestType.ADD_USER_GROUPS, params) as Effect.Effect<
					AddUserToGroupResponse,
					CCBGetError
				>,

			removeUserFromGroup: (params: {
				individualId: number;
				groupId: number;
			}): Effect.Effect<RemoveUserFromGroupResponse, CCBGetError> =>
				requestUnknown(CCBRequestType.REMOVE_USER_GROUP, params) as Effect.Effect<
					RemoveUserFromGroupResponse,
					CCBGetError
				>,

			getGroupParticipants: (
				groupId: number,
			): Effect.Effect<GroupParticipantsResponse, CCBGetError> =>
				requestUnknown(CCBRequestType.GET_GROUPS_MEMBERS, {
					groupId,
				}) as Effect.Effect<GroupParticipantsResponse, CCBGetError>,

			getGiving: (familyId, year, options): Effect.Effect<GivingResponse, CCBGetError> => {
				const params: CCBParams[CCBRequestType.GET_GIVING] =
					year === undefined ? { familyId } : { familyId, year };
				return requestUnknown(CCBRequestType.GET_GIVING, params, options);
			},

			getAttendanceProfile: (
				eventId: number,
				occurrence: string,
			): Effect.Effect<AttendanceProfileResponse, CCBGetError> =>
				requestUnknown(CCBRequestType.GET_ATTENDANCE_PROFILE, {
					eventId,
					occurrence,
				}) as Effect.Effect<AttendanceProfileResponse, CCBGetError>,

			createEventAttendance: (input: CreateEventAttendanceInput) =>
				post({
					endpoint: "srv=create_event_attendance",
					jsonData: {
						events: {
							event: {
								"@_id": input.eventId,
								"@_occurrence": input.occurrence,
								did_not_meet: "false",
								head_count: input.attendeeIds.length,
								attendees: {
									attendee: input.attendeeIds.map((id) => ({
										"@_id": id,
										"#text": "",
									})),
								},
								topic: input.topic ?? "",
								notes: input.notes ?? "",
								email_notification: "none",
							},
						},
					},
				}),
		};
	}),
}) {}

export const CCBServiceLive = Layer.effect(CCBService, CCBService.make);
