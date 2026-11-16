import { RedisService } from "@/effect/RedisService";
import { serviceRequest } from "@/utils/serviceRequest";
// oxlint-disable max-classes-per-file
// oxlint-disable max-statements
import {
	createCastrClient,
	type CastrClient,
	type CastrError,
	type CastrFetchFn,
	type LiveStreams,
	type UpdatePlatformRequest,
} from "@hccnj/castr";
import { Config, Context, DateTime, Duration, Effect, Layer, Redacted } from "effect";

const castrConfig = Config.all({
	username: Config.String("CASTR_USR"),
	password: Config.Redacted("CASTR_PW"),
	apiEndpoint: Config.String("CASTR_API_END_POINT"),
});

const CACHE_PREFIX = "castr-api";
const CACHE_TTL_SECONDS = 5;
const STALE_THRESHOLD_SECONDS = 3;
const MEMORY_CACHE_TTL = Duration.seconds(5);

const getLastPathSegment = (path: string): string | undefined => path.split("/").findLast(Boolean);

const extractAction = (url: string, method: "GET" | "PATCH"): string => {
	if (method === "PATCH") {
		return "patch_request";
	}

	try {
		const { pathname } = new URL(url);
		return getLastPathSegment(pathname) ?? "unknown";
	} catch {
		return getLastPathSegment(url) ?? "unknown";
	}
};

interface CachedCastrEntry {
	data: LiveStreams;
	cachedAt: number;
}

interface CastrServiceContract extends Omit<CastrClient, "getLiveStreams"> {
	getLiveStreams: Effect.Effect<LiveStreams, CastrError>;
	invalidateLiveStreamsCache: Effect.Effect<void>;
}

export class CastrService extends Context.Service<CastrService, CastrServiceContract>()(
	"CastrService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const { username, password: passwordRedacted, apiEndpoint } = yield* castrConfig;
			const password = Redacted.value(passwordRedacted);

			const getCacheKey = (url: string) => `${CACHE_PREFIX}:${url}`;

			const httpFetch: CastrFetchFn = (url, options) =>
				serviceRequest({
					url,
					options,
					service: "castr",
					action: extractAction(url, options.method),
				});

			const client = createCastrClient({ apiEndpoint, username, password }, httpFetch);

			const getFromRedis = Effect.fn("CastrService.getFromRedis")(function* (url: string) {
				return yield* redis.get(getCacheKey(url)).pipe(
					Effect.map((value) => {
						if (!value) {
							// oxlint-disable-next-line no-null
							return null;
						}
						try {
							return JSON.parse(value) as CachedCastrEntry;
						} catch {
							// oxlint-disable-next-line no-null
							return null;
						}
					}),
					// oxlint-disable-next-line no-null
					Effect.catchTag("RedisError", () => Effect.succeed(null)),
				);
			});

			const setToRedis = Effect.fn("CastrService.setToRedis")(function* (
				url: string,
				data: LiveStreams,
			) {
				const cachedAt = DateTime.toEpochMillis(yield* DateTime.now);
				const entry: CachedCastrEntry = {
					data,
					cachedAt,
				};
				return yield* redis
					.setex(getCacheKey(url), CACHE_TTL_SECONDS, JSON.stringify(entry))
					.pipe(Effect.catchTag("RedisError", () => Effect.void));
			});

			const isStale = (entry: CachedCastrEntry, now: number): boolean => {
				const ageSeconds = (now - entry.cachedAt) / 1000;
				return ageSeconds > STALE_THRESHOLD_SECONDS;
			};

			// Mutable ref assigned after cachedInvalidateWithTTL setup;
			// safe because backgroundRefresh is only called at runtime.
			let invalidateMemoryCacheRef: Effect.Effect<void> = Effect.void;

			const backgroundRefresh = Effect.fn("CastrService.backgroundRefresh")(function* (
				url: string,
			) {
				yield* Effect.gen(function* () {
					const freshData = yield* client.getLiveStreams();
					yield* setToRedis(url, freshData);
					yield* invalidateMemoryCacheRef;
				}).pipe(
					Effect.catchTags({
						CastrFetchError: (error) =>
							Effect.logWarning("Castr background refresh failed").pipe(
								Effect.annotateLogs({
									operation: "backgroundRefresh",
									url,
									error: error.message,
								}),
								Effect.asVoid,
							),
						CastrParseError: (error) =>
							Effect.logWarning("Castr background refresh failed").pipe(
								Effect.annotateLogs({
									operation: "backgroundRefresh",
									url,
									error: error.message,
								}),
								Effect.asVoid,
							),
					}),
				);
			});

			const getLiveStreamsImpl = Effect.gen(function* () {
				const url = "/live_streams";
				const cachedEntry = yield* getFromRedis(url);

				if (cachedEntry) {
					const now = DateTime.toEpochMillis(yield* DateTime.now);
					if (isStale(cachedEntry, now)) {
						yield* Effect.forkDetach(backgroundRefresh(url));
					}
					return cachedEntry.data;
				}

				const freshData = yield* client.getLiveStreams();
				yield* Effect.forkDetach(setToRedis(url, freshData));

				return freshData;
			}).pipe(Effect.withSpan("CastrService.getLiveStreams"));

			const [cachedGetLiveStreams, invalidateMemoryCache] = yield* Effect.cachedInvalidateWithTTL(
				getLiveStreamsImpl,
				MEMORY_CACHE_TTL,
			);
			invalidateMemoryCacheRef = invalidateMemoryCache;

			const invalidateLiveStreamsCache = Effect.gen(function* () {
				yield* invalidateMemoryCache;
				yield* redis
					.del(getCacheKey("/live_streams"))
					.pipe(Effect.catchTag("RedisError", () => Effect.void));
			}).pipe(Effect.withSpan("CastrService.invalidateLiveStreamsCache"));

			const patchPlatform = Effect.fn("CastrService.patchPlatform")(function* ({
				streamId,
				platformId,
				data,
			}: {
				streamId: string;
				platformId: string;
				data: UpdatePlatformRequest;
			}) {
				return yield* client.patchPlatform({
					streamId,
					platformId,
					data,
				});
			});

			return {
				getLiveStreams: cachedGetLiveStreams.pipe(
					Effect.withSpan("CastrService.getLiveStreams.cached"),
				),
				patchPlatform,
				invalidateLiveStreamsCache,
			};
		}),
	},
) {}

export const CastrServiceLive = Layer.effect(CastrService, CastrService.make);
