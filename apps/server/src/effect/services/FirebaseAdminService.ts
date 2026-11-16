import {
	app,
	AppCollections,
	auth,
	db,
	dbFieldValue,
	FBPaths,
	fieldPath,
	getStorageBucket,
	secondaryApp,
	secondaryDb,
} from "@/utils/firebase";
import { Temporal } from "@js-temporal/polyfill";
import { Clock, Context, Effect, Layer, Predicate, Schema } from "effect";
import { getAppCheck, type VerifyAppCheckTokenResponse } from "firebase-admin/app-check";
import {
	type DocumentData,
	type FieldPath,
	type FieldValue,
	type Firestore,
	type QuerySnapshot,
} from "firebase-admin/firestore";
import {
	getMessaging,
	type BatchResponse,
	type Message,
	type MulticastMessage,
} from "firebase-admin/messaging";

import type { CampusPreference } from "@/effect/services/campus/preference";
import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";

export type FirebaseAppCheckVerifyTokenResponse = VerifyAppCheckTokenResponse;
export type FirestoreDocumentData = DocumentData;

export class FirebaseMessagingError extends Schema.TaggedError<FirebaseMessagingError>()(
	"FirebaseMessagingError",
	{
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Firebase messaging: ${this.detail}`;
	}
}

export class FirebaseFirestoreWriteError extends Schema.TaggedError<FirebaseFirestoreWriteError>()(
	"FirebaseFirestoreWriteError",
	{
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Firebase Firestore write: ${this.detail}`;
	}
}

export class FirebaseFirestoreReadError extends Schema.TaggedError<FirebaseFirestoreReadError>()(
	"FirebaseFirestoreReadError",
	{
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Firebase Firestore read: ${this.detail}`;
	}
}

export const FIRESTORE_DOCUMENT_ID_FIELD = "__documentId";

interface FirebaseUserProfileUpdates {
	readonly firstName?: string | undefined;
	readonly lastName?: string | undefined;
	readonly phone?: string | undefined;
	readonly img?: string | undefined;
}

interface FirebaseAdminServiceContract {
	readonly app: App;
	readonly auth: Auth;
	readonly batchReadDocuments: (
		collection: string,
		docIds: readonly string[],
	) => Effect.Effect<readonly (DocumentData | undefined)[], FirebaseFirestoreReadError>;
	readonly collections: typeof AppCollections;
	readonly db: Firestore;
	readonly dbFieldValue: typeof FieldValue;
	readonly fieldPath: typeof FieldPath;
	readonly paths: typeof FBPaths;
	readonly secondaryApp: App;
	readonly secondaryDb: Firestore;
	deleteDocument: (
		collection: string,
		docId: string,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	findFirstByDocumentId: (
		collection: string,
		op: "<" | ">=",
		afterId: string,
	) => Effect.Effect<DocumentData | undefined, FirebaseFirestoreReadError>;
	generateDocumentId: (collection: string) => string;
	getStorageBucket: (bucketName?: string) => ReturnType<typeof getStorageBucket>;
	mergeDocument: (
		collection: string,
		docId: string,
		data: DocumentData,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	mergeUserDocument: (
		firebaseUid: string,
		updates: FirebaseUserProfileUpdates,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	mirrorUserCampusPreference: (
		preference: CampusPreference,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	updateUserActivity: (
		firebaseUid: string,
		appVersion?: string,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	readonly listPushTokenDocsByUserId: (
		userId: string,
	) => Effect.Effect<readonly DocumentData[], FirebaseFirestoreReadError>;
	/** First `wordActivationScriptures` document whose stored `verseId` field equals the value. */
	readonly findWordActivationScriptureByVerseId: (
		verseId: string,
	) => Effect.Effect<FirestoreDocumentEntry | undefined, FirebaseFirestoreReadError>;
	/** Every `wordActivationScriptures` document with its document ID. */
	readonly listWordActivationScriptures: Effect.Effect<
		readonly FirestoreDocumentEntry[],
		FirebaseFirestoreReadError
	>;
	readDocument: (
		collection: string,
		docId: string,
	) => Effect.Effect<DocumentData | undefined, FirebaseFirestoreReadError>;
	readonly sendEachForMulticast: (
		message: MulticastMessage,
	) => Effect.Effect<BatchResponse, FirebaseMessagingError>;
	sendMessage: (message: Message) => Effect.Effect<string, FirebaseMessagingError>;
	readonly subscribeTokensToTopic: (
		tokens: readonly string[],
		topic: string,
	) => Effect.Effect<void, FirebaseMessagingError>;
	readonly unsubscribeTokensFromTopic: (
		tokens: readonly string[],
		topic: string,
	) => Effect.Effect<void, FirebaseMessagingError>;
	verifyAppCheckToken: (token: string) => Promise<VerifyAppCheckTokenResponse>;
	writeDocument: (
		collection: string,
		docId: string,
		data: DocumentData,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
}

const mergeUserDocument = Effect.fn("FirebaseAdminService.mergeUserDocument")(function* (
	firebaseUid: string,
	updates: FirebaseUserProfileUpdates,
) {
	yield* Effect.tryPromise({
		try: () => db.collection(AppCollections.users).doc(firebaseUid).set(updates, { merge: true }),
		catch: (cause) =>
			new FirebaseFirestoreWriteError({
				detail: "Failed to merge user document",
				cause,
			}),
	});
});

const CampusPreferenceVersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const makeMirrorUserCampusPreference = (
	firestore: Pick<Firestore, "collection" | "runTransaction">,
) =>
	Effect.fn("FirebaseAdminService.mirrorUserCampusPreference")(function* (
		preference: CampusPreference,
	) {
		yield* Effect.tryPromise({
			try: () => {
				const userDocument = firestore.collection(AppCollections.users).doc(preference.firebaseUid);
				return firestore.runTransaction(async (transaction) => {
					const snapshot = await transaction.get(userDocument);
					const storedVersion: unknown = snapshot.get("campusPreferenceVersion");
					if (
						Schema.is(CampusPreferenceVersionSchema)(storedVersion) &&
						storedVersion > preference.campusPreferenceVersion
					) {
						return;
					}
					transaction.set(
						userDocument,
						{
							preferredCampusSlug: preference.preferredCampusSlug,
							campusPreferenceVersion: preference.campusPreferenceVersion,
						},
						{ merge: true },
					);
				});
			},
			catch: (cause) =>
				new FirebaseFirestoreWriteError({
					detail: "Failed to mirror user campus preference",
					cause,
				}),
		});
	});

const mirrorUserCampusPreference = makeMirrorUserCampusPreference(db);

export interface FirestoreDocumentEntry {
	readonly id: string;
	readonly data: DocumentData;
}

const toEntries = (snapshot: QuerySnapshot): readonly FirestoreDocumentEntry[] =>
	snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));

export const makeWordActivationScriptureReads = (
	firestore: Pick<Firestore, "collection">,
	collection: string,
) => {
	const scriptures = () => firestore.collection(collection);
	const findWordActivationScriptureByVerseId = Effect.fn(
		"FirebaseAdminService.findWordActivationScriptureByVerseId",
	)(function* (verseId: string) {
		const snapshot = yield* Effect.tryPromise({
			try: () => scriptures().where("verseId", "==", verseId).limit(1).get(),
			catch: (cause) =>
				new FirebaseFirestoreReadError({ detail: "Failed to find scripture by verseId", cause }),
		});
		return toEntries(snapshot)[0];
	});
	const listWordActivationScriptures = Effect.tryPromise({
		try: () => scriptures().get(),
		catch: (cause) =>
			new FirebaseFirestoreReadError({ detail: "Failed to list scriptures", cause }),
	}).pipe(
		Effect.map(toEntries),
		Effect.withSpan("FirebaseAdminService.listWordActivationScriptures"),
	);
	return { findWordActivationScriptureByVerseId, listWordActivationScriptures };
};

const { findWordActivationScriptureByVerseId, listWordActivationScriptures } =
	makeWordActivationScriptureReads(db, AppCollections.wordActivationScriptures);

// The Firestore console shows strings verbatim, so store church-local wall-clock
// time with its offset (EDT -04:00 / EST -05:00) instead of UTC.
const USER_METADATA_TIME_ZONE = "America/New_York";

function formatUserMetadataDateTime(epochMilliseconds: number): string {
	return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
		.toZonedDateTimeISO(USER_METADATA_TIME_ZONE)
		.toString({ smallestUnit: "second", timeZoneName: "never" });
}

const makeUpdateUserActivity = (
	firestore: Pick<Firestore, "collection" | "runTransaction">,
	currentTimeMillis: Effect.Effect<number> = Clock.currentTimeMillis,
) =>
	Effect.fn("FirebaseAdminService.updateUserActivity")(function* (
		firebaseUid: string,
		appVersion?: string,
	) {
		const epochMilliseconds = yield* currentTimeMillis;
		const userDocument = firestore.collection(AppCollections.users).doc(firebaseUid);

		yield* Effect.tryPromise({
			try: () =>
				firestore.runTransaction(async (transaction) => {
					const snapshot = await transaction.get(userDocument);
					const storedLastSignInTime = snapshot.get("userMetadata.lastSignInTime") as unknown;
					// Offsets differ across DST and legacy UTC values, so compare instants, not strings.
					const storedEpochMilliseconds = Predicate.isString(storedLastSignInTime)
						? Date.parse(storedLastSignInTime)
						: Number.NaN;

					if (
						Number.isNaN(storedEpochMilliseconds) ||
						storedEpochMilliseconds < epochMilliseconds
					) {
						transaction.update(
							userDocument,
							"userMetadata.lastSignInTime",
							formatUserMetadataDateTime(epochMilliseconds),
							...(appVersion ? ["userMetadata.appVersion", appVersion] : []),
						);
					}
				}),
			catch: (cause) =>
				new FirebaseFirestoreWriteError({
					detail: "Failed to update user activity",
					cause,
				}),
		});
	});

const updateUserActivity = makeUpdateUserActivity(db);

// Focused push-token methods keep domain services behind the Firebase adapter
// rather than exposing raw Firestore and messaging handles.
const listPushTokenDocsByUserId = Effect.fn("FirebaseAdminService.listPushTokenDocsByUserId")(
	function* (userId: string) {
		const snapshot = yield* Effect.tryPromise({
			try: () => db.collection(AppCollections.pushTokens).where("userId", "==", userId).get(),
			catch: (cause) =>
				new FirebaseFirestoreReadError({
					detail: "Failed to list push tokens by userId",
					cause,
				}),
		});
		return snapshot.docs.map((doc) => doc.data());
	},
);

const subscribeTokensToTopic = Effect.fn("FirebaseAdminService.subscribeTokensToTopic")(function* (
	tokens: readonly string[],
	topic: string,
) {
	if (tokens.length === 0) {
		return;
	}
	// subscribeToTopic resolves even when individual tokens fail; surface
	// partial failures so callers never record a subscription that was rejected.
	const response = yield* Effect.tryPromise({
		try: () => getMessaging().subscribeToTopic([...tokens], topic),
		catch: (cause) =>
			new FirebaseMessagingError({
				detail: `Failed to subscribe tokens to topic ${topic}`,
				cause,
			}),
	});
	if (response.failureCount > 0) {
		return yield* Effect.fail(
			new FirebaseMessagingError({
				detail: `FCM rejected ${response.failureCount} token(s) subscribing to topic ${topic}`,
				cause: response.errors,
			}),
		);
	}
});

const unsubscribeTokensFromTopic = Effect.fn("FirebaseAdminService.unsubscribeTokensFromTopic")(
	function* (tokens: readonly string[], topic: string) {
		if (tokens.length === 0) {
			return;
		}
		const response = yield* Effect.tryPromise({
			try: () => getMessaging().unsubscribeFromTopic([...tokens], topic),
			catch: (cause) =>
				new FirebaseMessagingError({
					detail: `Failed to unsubscribe tokens from topic ${topic}`,
					cause,
				}),
		});
		if (response.failureCount > 0) {
			return yield* Effect.fail(
				new FirebaseMessagingError({
					detail: `FCM rejected ${response.failureCount} token(s) unsubscribing from topic ${topic}`,
					cause: response.errors,
				}),
			);
		}
	},
);

const sendEachForMulticast = Effect.fn("FirebaseAdminService.sendEachForMulticast")(function* (
	message: MulticastMessage,
) {
	return yield* Effect.tryPromise({
		try: () => getMessaging().sendEachForMulticast(message),
		catch: (cause) =>
			new FirebaseMessagingError({
				detail: "Failed to send multicast push notification",
				cause,
			}),
	});
});

const batchReadDocuments = Effect.fn("FirebaseAdminService.batchReadDocuments")(function* (
	collection: string,
	docIds: readonly string[],
) {
	if (docIds.length === 0) {
		return [];
	}

	const docRefs = docIds.map((docId) => db.collection(collection).doc(docId));
	const snapshots = yield* Effect.tryPromise({
		try: () => db.getAll(...docRefs),
		catch: (cause) =>
			new FirebaseFirestoreReadError({
				detail: `Failed to batch read from ${collection}`,
				cause,
			}),
	});

	const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));

	return docIds.map((docId) => {
		const snapshot = snapshotsById.get(docId);
		return snapshot?.exists ? snapshot.data() : undefined;
	});
});

// Generic Firestore primitives — migration infrastructure for moving domain
// services off the raw `db` handle and behind this approved platform service.
// Deliberately broad; treat as a transitional adapter, not a pattern to spread.
// New code should prefer a focused, domain-specific method (see `mergeUserDocument`),
// and consumers should depend on a narrowed interface exposing only the ops they
// use (see VodService's `VodFirebaseDeps`) rather than the whole surface.
const readDocument = Effect.fn("FirebaseAdminService.readDocument")(function* (
	collection: string,
	docId: string,
) {
	const snapshot = yield* Effect.tryPromise({
		try: () => db.collection(collection).doc(docId).get(),
		catch: (cause) =>
			new FirebaseFirestoreReadError({
				detail: `Failed to read ${collection}/${docId}`,
				cause,
			}),
	});

	return snapshot.exists ? snapshot.data() : undefined;
});

const findFirstByDocumentId = Effect.fn("FirebaseAdminService.findFirstByDocumentId")(function* (
	collection: string,
	op: "<" | ">=",
	afterId: string,
) {
	const snapshot = yield* Effect.tryPromise({
		try: () => db.collection(collection).where(fieldPath.documentId(), op, afterId).limit(1).get(),
		catch: (cause) =>
			new FirebaseFirestoreReadError({
				detail: `Failed to query ${collection} by document id`,
				cause,
			}),
	});

	const [doc] = snapshot.docs;
	return doc
		? {
				...doc.data(),
				[FIRESTORE_DOCUMENT_ID_FIELD]: doc.id,
			}
		: undefined;
});

const generateDocumentId = (collection: string): string => db.collection(collection).doc().id;

const writeDocument = Effect.fn("FirebaseAdminService.writeDocument")(function* (
	collection: string,
	docId: string,
	data: DocumentData,
) {
	yield* Effect.tryPromise({
		try: () => db.collection(collection).doc(docId).set(data),
		catch: (cause) =>
			new FirebaseFirestoreWriteError({
				detail: `Failed to write ${collection}/${docId}`,
				cause,
			}),
	});
});

const mergeDocument = Effect.fn("FirebaseAdminService.mergeDocument")(function* (
	collection: string,
	docId: string,
	data: DocumentData,
) {
	yield* Effect.tryPromise({
		try: () => db.collection(collection).doc(docId).set(data, { merge: true }),
		catch: (cause) =>
			new FirebaseFirestoreWriteError({
				detail: `Failed to merge ${collection}/${docId}`,
				cause,
			}),
	});
});

const deleteDocument = Effect.fn("FirebaseAdminService.deleteDocument")(function* (
	collection: string,
	docId: string,
) {
	yield* Effect.tryPromise({
		try: () => db.collection(collection).doc(docId).delete(),
		catch: (cause) =>
			new FirebaseFirestoreWriteError({
				detail: `Failed to delete ${collection}/${docId}`,
				cause,
			}),
	});
});

export class FirebaseAdminService extends Context.Service<
	FirebaseAdminService,
	FirebaseAdminServiceContract
>()("FirebaseAdminService", {
	make: Effect.succeed({
		app,
		auth,
		batchReadDocuments,
		collections: AppCollections,
		db,
		dbFieldValue,
		fieldPath,
		paths: FBPaths,
		secondaryApp,
		secondaryDb,
		deleteDocument,
		findFirstByDocumentId,
		generateDocumentId,
		getStorageBucket: (bucketName?: string) => getStorageBucket(bucketName),
		findWordActivationScriptureByVerseId,
		listPushTokenDocsByUserId,
		listWordActivationScriptures,
		mergeDocument,
		mergeUserDocument,
		mirrorUserCampusPreference,
		readDocument,
		sendEachForMulticast,
		sendMessage: (message: Message) =>
			Effect.tryPromise({
				try: () => getMessaging().send(message),
				catch: (cause) =>
					new FirebaseMessagingError({
						detail: "Failed to send push notification",
						cause,
					}),
			}),
		subscribeTokensToTopic,
		unsubscribeTokensFromTopic,
		updateUserActivity,
		verifyAppCheckToken: (token: string) => getAppCheck(app).verifyToken(token),
		writeDocument,
	} satisfies FirebaseAdminServiceContract),
}) {}

export const FirebaseAdminServiceLive = Layer.effect(
	FirebaseAdminService,
	FirebaseAdminService.make,
);
