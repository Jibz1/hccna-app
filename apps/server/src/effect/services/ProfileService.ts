import { users } from "@/db/schema/users";
import { CACHE_POLICIES } from "@/effect/cache/policies";
import { createTwoTierCache, type CacheCodec } from "@/effect/cache/TwoTierCache";
import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

class ProfileFetchError extends Schema.TaggedError<ProfileFetchError>()("ProfileFetchError", {
	detail: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {
	override get message() {
		return `Profile fetch: ${this.detail}`;
	}
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

type UserDBProfile = typeof users.$inferSelect;

function decodeCacheDate<Input>(value: Input): Date | null {
	if (Predicate.isDate(value) && !Number.isNaN(value.getTime())) {
		return value;
	}

	if (!Predicate.isString(value)) {
		return null;
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function decodeNullableString<Input>(value: Input): Option.Option<string | null> {
	if (value === null || value === undefined) {
		return Option.some(null);
	}

	if (Predicate.isString(value)) {
		return Option.fromNullishOr(value);
	}

	return Option.none();
}

const profileCacheCodec: CacheCodec<UserDBProfile | null> = {
	encode: (profile) =>
		profile === null
			? null
			: {
					...profile,
					createdAt: profile.createdAt.toISOString(),
					updatedAt: profile.updatedAt.toISOString(),
					ccbProfileCheckedAt: profile.ccbProfileCheckedAt?.toISOString() ?? null,
				},
	decode: (value) => {
		if (value === null) {
			return Option.some(null);
		}

		if (
			!Predicate.isObject(value) ||
			!Predicate.isString(value.id) ||
			!Predicate.isString(value.firebaseUid) ||
			!Predicate.isString(value.email) ||
			!Predicate.isBoolean(value.isVerified) ||
			!Predicate.isBoolean(value.enrichmentPending)
		) {
			return Option.none();
		}

		const createdAt = decodeCacheDate(value.createdAt);
		const updatedAt = decodeCacheDate(value.updatedAt);
		const hasCcbProfileCheck =
			value.ccbProfileCheckedAt !== null && value.ccbProfileCheckedAt !== undefined;
		const ccbProfileCheckedAt = hasCcbProfileCheck
			? decodeCacheDate(value.ccbProfileCheckedAt)
			: null;
		if (!createdAt || !updatedAt || (hasCcbProfileCheck && !ccbProfileCheckedAt)) {
			return Option.none();
		}

		const firstName = decodeNullableString(value.firstName);
		const lastName = decodeNullableString(value.lastName);
		const phone = decodeNullableString(value.phone);
		const img = decodeNullableString(value.img);
		const ccbId = decodeNullableString(value.ccbId);
		const ccbFamilyId = decodeNullableString(value.ccbFamilyId);
		const provider = decodeNullableString(value.provider);
		const preferredCampusSlug = decodeNullableString(value.preferredCampusSlug);
		if (
			Option.isNone(preferredCampusSlug) ||
			!Predicate.isNumber(value.campusPreferenceVersion) ||
			!Number.isInteger(value.campusPreferenceVersion)
		) {
			return Option.none();
		}
		if (
			Option.isNone(firstName) ||
			Option.isNone(lastName) ||
			Option.isNone(phone) ||
			Option.isNone(img) ||
			Option.isNone(ccbId) ||
			Option.isNone(ccbFamilyId) ||
			Option.isNone(provider)
		) {
			return Option.none();
		}

		return Option.some({
			id: value.id,
			firebaseUid: value.firebaseUid,
			email: value.email,
			firstName: firstName.value,
			lastName: lastName.value,
			phone: phone.value,
			img: img.value,
			isVerified: value.isVerified,
			enrichmentPending: value.enrichmentPending,
			ccbId: ccbId.value,
			ccbFamilyId: ccbFamilyId.value,
			provider: provider.value,
			preferredCampusSlug: preferredCampusSlug.value,
			campusPreferenceVersion: value.campusPreferenceVersion,
			createdAt,
			updatedAt,
			ccbProfileCheckedAt,
		});
	},
};

// ═══════════════════════════════════════════════════════════════
// SERVICE DEFINITION
// ═══════════════════════════════════════════════════════════════

interface ClearCacheOptions {
	firebaseUid?: string;
	id?: string;
	email?: string;
}

interface ProfileServiceContract {
	lookupByFirebaseUid: (firebaseUid: string) => Effect.Effect<
		{
			profile: UserDBProfile | null;
			fromCache: boolean;
		},
		ProfileFetchError
	>;
	getByFirebaseUid: (firebaseUid: string) => Effect.Effect<UserDBProfile | null, ProfileFetchError>;
	getById: (id: string) => Effect.Effect<UserDBProfile | null, ProfileFetchError>;
	getByEmail: (email: string) => Effect.Effect<UserDBProfile | null, ProfileFetchError>;
	clearCache: (options: ClearCacheOptions) => Effect.Effect<void>;
}

export class ProfileService extends Context.Service<ProfileService, ProfileServiceContract>()(
	"ProfileService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const lru = yield* LRUService;
			const { db } = yield* DrizzleService;
			const profileCache = createTwoTierCache<UserDBProfile | null>(
				{ lru, redis },
				CACHE_POLICIES.profile,
				{ codec: profileCacheCodec },
			);

			// ─────────────────────────────────────────────────────────────
			// Database Fetch Helpers
			// ─────────────────────────────────────────────────────────────

			const fetchFromDb = (whereClause: ReturnType<typeof eq>, errorMessage: string) =>
				Effect.tryPromise({
					try: async () => {
						const [user] = await db.select().from(users).where(whereClause).limit(1);
						return user ?? null;
					},
					catch: (error) => new ProfileFetchError({ detail: errorMessage, cause: error }),
				});

			// ─────────────────────────────────────────────────────────────
			// Service Methods with Caching
			// ─────────────────────────────────────────────────────────────

			const lookupByFirebaseUid = Effect.fn("ProfileService.lookupByFirebaseUid")(function* (
				firebaseUid: string,
			) {
				const cacheKey = `Id:${firebaseUid}`;
				const result = yield* profileCache.getOrLoad(
					cacheKey,
					Effect.gen(function* () {
						yield* Effect.logDebug("Cache miss, fetching from Postgres").pipe(
							Effect.annotateLogs({
								operation: "getByFirebaseUid",
								firebaseUidProvided: true,
							}),
						);

						return yield* fetchFromDb(
							eq(users.firebaseUid, firebaseUid),
							"Failed to fetch profile by Firebase UID",
						);
					}),
					{ shouldCache: (value) => value !== null },
				);

				yield* Effect.logDebug("Profile cache lookup complete").pipe(
					Effect.annotateLogs({
						operation: "getByFirebaseUid",
						source: result.source,
						freshness: result.freshness,
						firebaseUidProvided: true,
					}),
				);

				return { profile: result.value, fromCache: result.source !== "loader" };
			});

			const getByFirebaseUid = (firebaseUid: string) =>
				lookupByFirebaseUid(firebaseUid).pipe(Effect.map((result) => result.profile));

			const getById = Effect.fn("ProfileService.getById")(function* (id: string) {
				const cacheKey = `id:${id}`;
				const result = yield* profileCache.getOrLoad(
					cacheKey,
					Effect.gen(function* () {
						yield* Effect.logDebug("Cache miss, fetching from Postgres").pipe(
							Effect.annotateLogs({ operation: "getById", idProvided: true }),
						);

						return yield* fetchFromDb(eq(users.id, id), "Failed to fetch profile by ID");
					}),
					{ shouldCache: (value) => value !== null },
				);

				yield* Effect.logDebug("Profile cache lookup complete").pipe(
					Effect.annotateLogs({
						operation: "getById",
						source: result.source,
						freshness: result.freshness,
						idProvided: true,
					}),
				);

				return result.value;
			});

			const getByEmail = Effect.fn("ProfileService.getByEmail")(function* (email: string) {
				const cacheKey = `email:${email}`;
				const result = yield* profileCache.getOrLoad(
					cacheKey,
					Effect.gen(function* () {
						yield* Effect.logDebug("Cache miss, fetching from Postgres").pipe(
							Effect.annotateLogs({
								operation: "getByEmail",
								emailProvided: true,
							}),
						);

						return yield* fetchFromDb(eq(users.email, email), "Failed to fetch profile by email");
					}),
					{ shouldCache: (value) => value !== null },
				);

				yield* Effect.logDebug("Profile cache lookup complete").pipe(
					Effect.annotateLogs({
						operation: "getByEmail",
						source: result.source,
						freshness: result.freshness,
						emailProvided: true,
					}),
				);

				return result.value;
			});

			const clearCache = Effect.fn("ProfileService.clearCache")(function* (
				options: ClearCacheOptions,
			) {
				const clearOps: Effect.Effect<void>[] = [];

				if (options.firebaseUid) {
					clearOps.push(profileCache.invalidate(`Id:${options.firebaseUid}`));
				}
				if (options.id) {
					clearOps.push(profileCache.invalidate(`id:${options.id}`));
				}
				if (options.email) {
					clearOps.push(profileCache.invalidate(`email:${options.email}`));
				}

				if (clearOps.length > 0) {
					yield* Effect.all(clearOps, { concurrency: "unbounded" });
				}

				yield* Effect.logDebug("Profile cache cleared").pipe(
					Effect.annotateLogs({
						operation: "clearCache",
						firebaseUidProvided: Boolean(options.firebaseUid),
						idProvided: Boolean(options.id),
						emailProvided: Boolean(options.email),
					}),
				);
			});

			return {
				lookupByFirebaseUid,
				getByFirebaseUid,
				getById,
				getByEmail,
				clearCache,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(ProfileService, ProfileService.make);
}

export const ProfileServiceLive = Layer.effect(ProfileService, ProfileService.make);
