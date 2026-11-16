import { PushSendError, PushTokenRegistrationError } from "@/effect/services/push/errors";
import { CAMPUS_STREAM_AUDIENCE_TOPIC } from "@/effect/services/push/streamAudience";
import {
	allowsCategory,
	followCampusTopic,
	isPreferenceTopic,
	NOTIFICATION_PREFERENCES_TOPIC,
	normalizeTopics,
	PREFERENCE_TOPICS,
	type NotificationCategory,
} from "@/effect/services/push/topics";
import { CAMPUS_SLUGS, campusTopic, type CampusSlug } from "@/utils/campuses";
import { omitUndefined } from "@/utils/omitUndefined";
import { DateTime, Predicate, Effect } from "effect";
import { createHash } from "node:crypto";

import type {
	FirebaseFirestoreReadError,
	FirebaseFirestoreWriteError,
	FirebaseMessagingError,
	FirestoreDocumentData,
} from "@/effect/services/FirebaseAdminService";

export interface RegisterPushTokenInput {
	readonly token: string;
	readonly logoutKey?: string | null | undefined;
	readonly userId?: string | null;
	readonly platform?: string | null;
	readonly channels?: readonly (string | null | undefined)[] | null;
	readonly campus?: { readonly slug: CampusSlug; readonly version: number };
	readonly campusStreamNotifications?: boolean;
}

export interface UnregisterPushTokenInput {
	readonly token: string;
	readonly logoutKey: string;
	readonly legacyUserId?: string | null | undefined;
}

const retirementId = ({ token, logoutKey }: UnregisterPushTokenInput) =>
	createHash("sha256")
		.update(JSON.stringify([token, logoutKey]))
		.digest("hex");

// A marker only has to outlive a registration still in flight, which the 20s
// request timeout ends in seconds. Any anonymous client can write markers, so
// a Firestore TTL policy on `expireAt` deletes them after this window.
const RETIREMENT_MARKER_TTL = { days: 7 };

// Registration and cleanup share this rule: a stored key that cleanup rejects
// would leave the registration impossible to detach.
const isValidLogoutKey = (logoutKey: string) => logoutKey.trim() !== "" && logoutKey.length <= 256;

export interface RegisteredPushToken {
	readonly token: string;
	readonly topics: readonly string[];
	readonly campusSlug?: string;
	readonly campusPreferenceVersion?: number;
}

export interface SendToUserInput {
	readonly userId: string;
	readonly notification: {
		readonly title: string;
		readonly body: string;
		readonly imageUrl?: string;
	};
	readonly data?: Record<string, string>;
	/** Skips devices whose notification settings turned this category off. */
	readonly category?: NotificationCategory;
}

export interface PushSendReport {
	readonly successCount: number;
	readonly failureCount: number;
	readonly prunedTokens: readonly string[];
}

// Structural mirrors of the firebase-admin multicast types for the slice this
// repository uses — importing them would trip the effect-boundaries check.
interface PushMulticastMessage {
	readonly tokens: string[];
	readonly notification: {
		readonly title: string;
		readonly body: string;
		readonly imageUrl?: string;
	};
	readonly data?: Record<string, string>;
	readonly apns?: {
		readonly payload: {
			readonly aps: Record<string, never>;
			readonly body: Record<string, string>;
		};
	};
}

interface PushBatchResponse {
	readonly successCount: number;
	readonly failureCount: number;
	readonly responses: readonly { readonly success: boolean; readonly error?: unknown }[];
}

interface PushTokenFirebaseDeps {
	readonly collection: string;
	readonly serverTimestamp: () => unknown;
	readonly readDocument: (
		collection: string,
		docId: string,
	) => Effect.Effect<FirestoreDocumentData | undefined, FirebaseFirestoreReadError>;
	readonly mergeDocument: (
		collection: string,
		docId: string,
		data: FirestoreDocumentData,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	readonly deleteDocument: (
		collection: string,
		docId: string,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	readonly listPushTokenDocsByUserId: (
		userId: string,
	) => Effect.Effect<readonly FirestoreDocumentData[], FirebaseFirestoreReadError>;
	readonly subscribeTokensToTopic: (
		tokens: readonly string[],
		topic: string,
	) => Effect.Effect<void, FirebaseMessagingError>;
	readonly unsubscribeTokensFromTopic: (
		tokens: readonly string[],
		topic: string,
	) => Effect.Effect<void, FirebaseMessagingError>;
	readonly sendEachForMulticast: (
		message: PushMulticastMessage,
	) => Effect.Effect<PushBatchResponse, FirebaseMessagingError>;
}

const INVALID_TOKEN_CODES = new Set([
	"messaging/registration-token-not-registered",
	"messaging/invalid-registration-token",
]);

// FCM's hard limit on tokens per sendEachForMulticast call.
const MULTICAST_CHUNK_SIZE = 500;

const errorCode = (cause: unknown): string | undefined =>
	Predicate.isObject(cause) && cause !== null && "code" in cause && Predicate.isString(cause.code)
		? cause.code
		: undefined;

const isInvalidToken = (cause: unknown): boolean => {
	const code = errorCode(cause);
	if (code && INVALID_TOKEN_CODES.has(code)) {
		return true;
	}
	return (
		Array.isArray(cause) &&
		cause.some(
			(entry) => Predicate.isObject(entry) && "error" in entry && isInvalidToken(entry.error),
		)
	);
};

const toRegistrationError = (error: { message: string; cause?: unknown }) =>
	new PushTokenRegistrationError({
		detail: error.message,
		cause: error.cause,
		retryable: !isInvalidToken(error.cause),
	});

const toSendError = (error: { message: string; cause?: unknown }) =>
	new PushSendError({ detail: error.message, cause: error.cause });

// Every known topic (each campus, each preference topic and announcement) fits
// in one round, while client-supplied channels, which have no count limit, can't
// fan out into thousands of simultaneous FCM requests.
const FCM_TOPIC_CONCURRENCY = CAMPUS_SLUGS.length + PREFERENCE_TOPICS.length + 1;

/**
 * One registration round: its FCM calls touch different topics, so they run
 * together, while the rounds themselves keep their order. Each call finishes
 * even if another fails, because a request that reached FCM cannot be
 * cancelled and the token lock must outlive it.
 */
const inOneRound = (calls: readonly Effect.Effect<void, FirebaseMessagingError>[]) =>
	Effect.forEach(calls, (call) => Effect.uninterruptible(call), {
		concurrency: FCM_TOPIC_CONCURRENCY,
		discard: true,
	}).pipe(Effect.mapError(toRegistrationError));

const storedTopics = (
	doc: FirestoreDocumentData | undefined,
	field: "topics" | "pendingTopics",
): string[] => {
	const value = doc?.[field];
	return Array.isArray(value) ? value.filter((topic) => Predicate.isString(topic)) : [];
};

const isMarker = (topic: string) => topic === NOTIFICATION_PREFERENCES_TOPIC;
// Category and follow topics, which a device may hold only alongside the marker.
const needsMarker = (topic: string) => isPreferenceTopic(topic) && !isMarker(topic);
const isAudience = (topic: string) => topic === CAMPUS_STREAM_AUDIENCE_TOPIC;
// Changes made in the second round, once the first round's have applied.
const joinsLate = (topic: string) => needsMarker(topic) || isAudience(topic);
const leavesLate = (topic: string) => isMarker(topic) || isAudience(topic);

/**
 * Owns the push-token registry documents and FCM topic/multicast calls,
 * delegating raw Firestore and messaging I/O to the narrowed
 * `FirebaseAdminService` ops it is given.
 */
export const createPushTokenRepository = (deps: PushTokenFirebaseDeps) => {
	const {
		collection,
		serverTimestamp,
		readDocument,
		mergeDocument,
		deleteDocument,
		listPushTokenDocsByUserId,
		subscribeTokensToTopic,
		unsubscribeTokensFromTopic,
		sendEachForMulticast,
	} = deps;

	const registerToken = Effect.fn("PushTokenService.registerToken")(function* (
		input: RegisterPushTokenInput,
	) {
		// An empty key is a legacy registration without one.
		const logoutKey = input.logoutKey || null;
		if (logoutKey !== null && !isValidLogoutKey(logoutKey)) {
			return yield* new PushTokenRegistrationError({
				detail: "Invalid push logout key",
				retryable: false,
			});
		}
		const [retired, existing] = yield* Effect.all(
			[
				logoutKey === null
					? Effect.undefined
					: readDocument(`${collection}-retired`, retirementId({ token: input.token, logoutKey })),
				readDocument(collection, input.token),
			],
			{ concurrency: 2 },
		).pipe(Effect.mapError(toRegistrationError));
		if (retired) {
			return yield* new PushTokenRegistrationError({
				detail: "This push registration was signed out",
				retryable: false,
			});
		}
		const campusStreamNotifications = Boolean(input.campus && input.campusStreamNotifications);
		// The device's own campus follows the livestreams category, so a follow
		// kept from before it became the preferred campus is dropped, including
		// when reconciliation applies a campus chosen on another device.
		const ownCampusFollow = input.campus && followCampusTopic(input.campus.slug);
		const topics = normalizeTopics(
			input.campus ? [...(input.channels ?? []), campusTopic(input.campus.slug)] : input.channels,
			{ allowPreferences: campusStreamNotifications },
		).filter((topic) => topic !== CAMPUS_STREAM_AUDIENCE_TOPIC && topic !== ownCampusFollow);
		if (campusStreamNotifications) {
			topics.push(CAMPUS_STREAM_AUDIENCE_TOPIC);
		}

		const previousTopics = storedTopics(existing, "topics");
		const pendingTopics = storedTopics(existing, "pendingTopics");

		// FCM first, doc last: the stored topics must never claim a subscription
		// state that was not actually applied at FCM. An attempt marks the doc
		// dirty before its first FCM call and only its final write clears the
		// mark, so a clean doc lists exactly the topics FCM holds and a missing doc
		// means none. Then only the difference needs FCM calls: none in steady state.
		const confirmed = !existing || existing.dirty === false;
		// A dirty doc, or one written before the mark existed, may hide FCM changes
		// whose final write failed: every desired topic is applied again, and every
		// topic it could hold is removed unless desired. That covers each known
		// preference topic, the audience, in follow-campus mode the whole known
		// campus set, and any other topic a failed attempt may have subscribed.
		const addedTopics = confirmed
			? topics.filter((topic) => !previousTopics.includes(topic))
			: topics;
		const removedTopics = (
			confirmed
				? previousTopics
				: [
						...new Set([
							...previousTopics,
							...pendingTopics,
							...PREFERENCE_TOPICS,
							CAMPUS_STREAM_AUDIENCE_TOPIC,
							...(input.campus ? CAMPUS_SLUGS.map((slug) => campusTopic(slug)) : []),
						]),
					]
		).filter((topic) => !topics.includes(topic));

		if (addedTopics.length > 0 || removedTopics.length > 0) {
			// Kept until a final write clears it, so a topic subscribed by any
			// failed attempt stays known to the next one.
			yield* mergeDocument(collection, input.token, {
				token: input.token,
				dirty: true,
				pendingTopics: [...new Set([...pendingTopics, ...addedTopics])],
			}).pipe(Effect.mapError(toRegistrationError));
		}

		// Suspended so each FCM call is made only when its round runs it.
		const subscribe = (topic: string) =>
			Effect.suspend(() => subscribeTokensToTopic([input.token], topic));
		const unsubscribe = (topic: string) =>
			Effect.suspend(() => unsubscribeTokensFromTopic([input.token], topic));

		// Only the preferences marker and the stream audience order these calls.
		// The preferences marker joins before its category and follow topics and
		// leaves after them, so no device holds one of those topics without the
		// marker. The stream sends rely on that to keep their audiences apart. The
		// audience marker follows its destination topics, the campus topic and
		// announcement. Every other change happens in the first round.
		yield* inOneRound([
			...addedTopics.filter((topic) => !joinsLate(topic)).map((topic) => subscribe(topic)),
			...removedTopics.filter((topic) => !leavesLate(topic)).map((topic) => unsubscribe(topic)),
		]);
		yield* inOneRound([
			...addedTopics.filter((topic) => joinsLate(topic)).map((topic) => subscribe(topic)),
			...removedTopics.filter((topic) => leavesLate(topic)).map((topic) => unsubscribe(topic)),
		]);

		yield* mergeDocument(
			collection,
			input.token,
			omitUndefined({
				token: input.token,
				topics,
				// Always written: a null clears ownership left by a previous user so a
				// device that signs out stops receiving that user's targeted sends.
				userId: input.userId ?? null,
				logoutKey,
				followPreferredCampus: Boolean(input.campus),
				campusStreamNotifications,
				campusSlug: input.campus?.slug ?? null,
				campusPreferenceVersion: input.campus?.version ?? null,
				platform: input.platform || undefined,
				dirty: false,
				pendingTopics: [],
				// A failed first attempt leaves a doc holding only its write-ahead mark.
				createdAt: existing?.createdAt ? undefined : serverTimestamp(),
				updatedAt: serverTimestamp(),
			}),
		).pipe(Effect.mapError(toRegistrationError));

		return input.campus
			? {
					token: input.token,
					topics,
					campusSlug: input.campus.slug,
					campusPreferenceVersion: input.campus.version,
				}
			: ({ token: input.token, topics } satisfies RegisteredPushToken);
	});

	const unregisterToken = Effect.fn("PushTokenService.unregisterToken")(function* (
		input: UnregisterPushTokenInput,
	) {
		if (!isValidLogoutKey(input.logoutKey) || !input.token.trim()) {
			return yield* new PushTokenRegistrationError({
				detail: "Invalid push logout credentials",
				retryable: false,
			});
		}
		// Retire even before registration arrives: an aborted client registration
		// may still be in flight, for example waiting for a database connection on
		// another server, and must be rejected once it takes the token lock.
		const now = yield* DateTime.now;
		yield* mergeDocument(`${collection}-retired`, retirementId(input), {
			retiredAt: serverTimestamp(),
			expireAt: DateTime.toDateUtc(DateTime.add(now, RETIREMENT_MARKER_TTL)),
		}).pipe(Effect.mapError(toRegistrationError));
		const existing = yield* readDocument(collection, input.token).pipe(
			Effect.mapError(toRegistrationError),
		);
		if (
			!existing ||
			(existing.logoutKey !== input.logoutKey &&
				!(input.legacyUserId && !existing.logoutKey && existing.userId === input.legacyUserId))
		) {
			return;
		}
		// Stop targeted sends before touching FCM. Preserve the key/topics until
		// FCM confirms cleanup, so a partial failure remains safe to retry.
		yield* mergeDocument(collection, input.token, {
			userId: null,
			logoutKey: input.logoutKey,
			followPreferredCampus: false,
		}).pipe(Effect.mapError(toRegistrationError));
		yield* registerToken({ token: input.token }).pipe(
			Effect.catchTag("PushTokenRegistrationError", (error) =>
				isInvalidToken(error.cause)
					? deleteDocument(collection, input.token).pipe(Effect.mapError(toRegistrationError))
					: Effect.fail(error),
			),
		);
	});

	const sendToUser = Effect.fn("PushTokenService.sendToUser")(function* (input: SendToUserInput) {
		const docs = yield* listPushTokenDocsByUserId(input.userId).pipe(Effect.mapError(toSendError));
		const { category } = input;
		const tokens = docs
			.filter(
				(doc) => !category || allowsCategory(Array.isArray(doc.topics) ? doc.topics : [], category),
			)
			.map((doc) => doc.token)
			.filter((token): token is string => Predicate.isString(token));

		if (tokens.length === 0) {
			return {
				successCount: 0,
				failureCount: 0,
				prunedTokens: [],
			} satisfies PushSendReport;
		}

		let successCount = 0;
		let failureCount = 0;
		const prunedTokens: string[] = [];

		// FCM caps sendEachForMulticast at 500 tokens per call.
		for (let start = 0; start < tokens.length; start += MULTICAST_CHUNK_SIZE) {
			const chunk = tokens.slice(start, start + MULTICAST_CHUNK_SIZE);
			const batch = yield* sendEachForMulticast(
				omitUndefined({
					tokens: chunk,
					notification: omitUndefined({
						title: input.notification.title,
						body: input.notification.body,
						imageUrl: input.notification.imageUrl || undefined,
					}),
					data: input.data ?? undefined,
					// Match Expo's normalized iOS data while retaining native FCM fields.
					apns: input.data ? { payload: { aps: {}, body: input.data } } : undefined,
				}),
			).pipe(Effect.mapError(toSendError));

			successCount += batch.successCount;
			failureCount += batch.failureCount;

			yield* Effect.forEach(
				batch.responses,
				(response, index) =>
					Effect.gen(function* () {
						const code = errorCode(response.error);
						const staleToken = chunk[index];
						if (!response.success && code && INVALID_TOKEN_CODES.has(code) && staleToken) {
							prunedTokens.push(staleToken);
							yield* deleteDocument(collection, staleToken).pipe(
								Effect.catchTag("FirebaseFirestoreWriteError", () => Effect.void),
							);
						}
					}),
				{ discard: true },
			);
		}

		return { successCount, failureCount, prunedTokens } satisfies PushSendReport;
	});

	return {
		registerToken: (input: RegisterPushTokenInput) =>
			registerToken(input).pipe(
				Effect.catchTag("PushTokenRegistrationError", (error) =>
					isInvalidToken(error.cause)
						? deleteDocument(collection, input.token).pipe(
								Effect.mapError(toRegistrationError),
								Effect.andThen(Effect.fail(error)),
							)
						: Effect.fail(error),
				),
			),
		sendToUser,
		unregisterToken,
	};
};
