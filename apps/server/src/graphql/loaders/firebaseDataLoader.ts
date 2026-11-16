import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import {
	UserProfileDataSchema,
	UserProfileDocSchema,
	type UserProfileData,
	type UserProfileDoc,
} from "@/types/userProfile";
import DataLoader from "dataloader";
import { Effect, Predicate, Result, Schema } from "effect";

import type { EffectRunner } from "@/effect/DataLoaderFactory";

type UserDocProfile = UserProfileData;
const logger = getLogger();

const getSchemaIssues = (cause: unknown) => [String(cause)];

function normalizeUserProfile(rawData: UserProfileDoc): UserDocProfile | null {
	if (!rawData.firstName || !rawData.lastName || !rawData.img || !rawData.provider) {
		logger.warn(
			{
				uid: rawData.uid,
				missingRequiredFields: ["firstName", "lastName", "img", "provider"].filter(
					(field) => !rawData[field as keyof UserProfileDoc],
				),
			},
			"User profile missing required fields",
		);
		return null;
	}

	const normalized = Schema.decodeUnknownResult(UserProfileDataSchema)({
		...rawData,
		firstName: rawData.firstName,
		lastName: rawData.lastName,
		img: rawData.img,
		provider: rawData.provider,
	});

	if (Result.isFailure(normalized)) {
		logger.warn(
			{
				uid: rawData.uid,
				issues: getSchemaIssues(normalized.failure),
			},
			"User profile failed normalization",
		);
		return null;
	}

	return normalized.success;
}

/**
 * Batch function for User Profile DataLoader
 * Fetches multiple user profiles from Firestore in parallel
 */
async function batchUserProfileRequests(
	runPromise: EffectRunner<FirebaseAdminService>,
	uids: readonly string[],
): Promise<(UserDocProfile | null)[]> {
	const toUserProfile = (userDoc: {
		exists: boolean;
		data: () => unknown;
	}): UserDocProfile | null => {
		if (!userDoc.exists) {
			// oxlint-disable-next-line no-null
			return null;
		}

		const rawPayload = userDoc.data();
		const parsed = Schema.decodeUnknownResult(UserProfileDocSchema)(rawPayload);
		if (Result.isFailure(parsed)) {
			const uid =
				Predicate.isObject(rawPayload) &&
				Predicate.hasProperty(rawPayload, "uid") &&
				Predicate.isString(rawPayload.uid)
					? rawPayload.uid
					: undefined;

			logger.warn(
				{
					uid,
					issues: getSchemaIssues(parsed.failure),
				},
				"Invalid user profile payload from Firestore",
			);
			return null;
		}

		return normalizeUserProfile(parsed.success);
	};

	try {
		const userDocs = await runPromise(
			Effect.gen(function* () {
				const firebaseAdmin = yield* FirebaseAdminService;
				return yield* firebaseAdmin.batchReadDocuments(firebaseAdmin.collections.users, uids);
			}),
		);

		return userDocs.map((userDoc) =>
			userDoc
				? toUserProfile({
						data: () => userDoc,
						exists: true,
					})
				: null,
		);
	} catch (error) {
		logger.error(
			{ err: error },
			"Error fetching user profiles in batch, falling back to per-user fetch",
		);

		return Promise.all(
			uids.map(async (uid) => {
				try {
					const userDoc = await runPromise(
						Effect.gen(function* () {
							const firebaseAdmin = yield* FirebaseAdminService;
							return yield* firebaseAdmin.readDocument(firebaseAdmin.collections.users, uid);
						}),
					);

					return userDoc
						? toUserProfile({
								data: () => userDoc,
								exists: true,
							})
						: null;
				} catch (userError) {
					logger.error({ err: userError, uid }, "Error fetching user profile for UID");
					// oxlint-disable-next-line no-null
					return null;
				}
			}),
		);
	}
}

/**
 * Creates a new Firebase User Profile DataLoader instance
 */
export function createUserProfileDataLoader(runPromise: EffectRunner<FirebaseAdminService>) {
	return new DataLoader<string, UserDocProfile | null>(
		(uids) => batchUserProfileRequests(runPromise, uids),
		{
			// Cache for the duration of a single request
			cache: true,
			// Maximum batch size
			maxBatchSize: 50,
			// Name for APM tools
			name: "FirebaseUserProfileDataLoader",
		},
	);
}
