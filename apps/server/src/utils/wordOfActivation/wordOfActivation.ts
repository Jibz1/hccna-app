import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import { FIRST_INDEX } from "@/utils/constants";
import { Effect, Predicate, Schema } from "effect";

import type { CollectionReference, DocumentSnapshot } from "firebase-admin/firestore";

export const VerseDataSchema = Schema.Struct({
	book: Schema.String,
	verseId: Schema.String,
	img: Schema.Array(Schema.String),
	stBook: Schema.Array(Schema.String),
	text: Schema.String,
	nlt_translation: Schema.String,
});
export type VerseData = typeof VerseDataSchema.Type;

interface WordActData {
	email: string;
	Name: string;
	sub: boolean;
}

export const WordActivationSubSchema = Schema.Struct({
	email: Schema.String,
	Name: Schema.String,
	lastUpdate: Schema.optional(Schema.Number),
	monthlySub: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
	wordActivationId: Schema.String,
	profileID: Schema.String,
});
export type WordActivationSub = typeof WordActivationSubSchema.Type;

const toVerseData = <Input>(docId: string, value: Input): VerseData =>
	Schema.decodeUnknownSync(VerseDataSchema)(
		Predicate.isObject(value) ? { verseId: docId, ...value } : { verseId: docId },
	);

class WordActivationFirestoreError extends Schema.TaggedError<WordActivationFirestoreError>()(
	"WordActivationFirestoreError",
	{
		operation: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Word activation Firestore (${this.operation}) failed`;
	}
}

const getRandomIdFromWordActivationCollectionEffect = Effect.gen(function* () {
	const { db, fieldPath, AppCollections } = yield* FirebaseAdminContext;

	const quotesColl = db.collection(AppCollections.wordActivationScriptures);
	const key = quotesColl.doc().id;

	const getQuotes = (op: "<" | ">=") =>
		Effect.tryPromise({
			try: async () => {
				const snapshot = await quotesColl.where(fieldPath.documentId(), op, key).limit(1).get();

				if (snapshot.empty) {
					// oxlint-disable-next-line no-null
					return null;
				}
				// oxlint-disable-next-line no-null
				let data: VerseData | null = null;
				snapshot.forEach((doc: DocumentSnapshot) => {
					data = toVerseData(doc.id, doc.data());
				});
				return data;
			},
			catch: (error) =>
				new WordActivationFirestoreError({
					operation: "getQuotes",
					cause: error,
				}),
		});

	let verseData = yield* getQuotes(">=");
	if (!verseData) {
		verseData = yield* getQuotes("<");
	}

	if (!verseData) {
		return yield* Effect.fail(
			new WordActivationFirestoreError({
				operation: "getRandomIdFromWordActivationCollectionEffect.noVerses",
			}),
		);
	}

	return verseData;
});

const getWordOfActivationByIdEffect = (id?: string) =>
	Effect.gen(function* () {
		if (!id || id === "") {
			return yield* getRandomIdFromWordActivationCollectionEffect;
		}

		const { db, AppCollections } = yield* FirebaseAdminContext;

		const verseData = yield* Effect.tryPromise({
			try: async () => {
				const doc = await db.collection(AppCollections.wordActivationScriptures).doc(id).get();
				// oxlint-disable-next-line no-null
				return doc.exists ? toVerseData(doc.id, doc.data()) : null;
			},
			catch: (error) =>
				new WordActivationFirestoreError({
					operation: "getWordOfActivationByIdEffect",
					cause: error,
				}),
		});

		if (!verseData) {
			return yield* Effect.fail(
				new WordActivationFirestoreError({
					operation: "getWordOfActivationByIdEffect.notFound",
				}),
			);
		}

		return { ...verseData, verseId: id };
	});

/**
 * The member's subscription, created with a random verse when they have none. Subscriptions live
 * in the secondary project, where `getByEmail` looks them up and the monthly rotation assigns and
 * delivers them; verses live in the primary project.
 *
 * Until `woa:copy-subscriptions` has run, members the app subscribed earlier have theirs only in the
 * primary project. They keep that subscription and its verse rather than getting a new one, which
 * the copy would then skip. Drop this primary fallback once the copy has run.
 */
export const getOrAssignWordOfActivationEffect = (data: WordActData) =>
	Effect.gen(function* () {
		const { db, secondaryDb, AppCollections } = yield* FirebaseAdminContext;
		const { email, Name, sub } = data;

		const findSubscribeEmailIn = (collection: CollectionReference) =>
			Effect.tryPromise({
				try: () => collection.where("email", "==", email).get(),
				catch: (error) =>
					new WordActivationFirestoreError({
						operation: "findSubscribeEmail",
						cause: error,
					}),
			});

		let subscriptions = secondaryDb.collection(AppCollections.wordActivationSub);
		let findSubscribeEmail = yield* findSubscribeEmailIn(subscriptions);
		if (findSubscribeEmail.empty) {
			const primarySubscriptions = db.collection(AppCollections.wordActivationSub);
			const primaryMatch = yield* findSubscribeEmailIn(primarySubscriptions);
			if (!primaryMatch.empty) {
				subscriptions = primarySubscriptions;
				findSubscribeEmail = primaryMatch;
			}
		}

		if (findSubscribeEmail.empty) {
			const wordActivation = yield* getWordOfActivationByIdEffect();
			const createProfile = {
				Name,
				email,
				monthlySub: sub,
				wordActivationId: wordActivation.verseId,
			};

			yield* Effect.tryPromise({
				try: () => subscriptions.add(createProfile),
				catch: (error) =>
					new WordActivationFirestoreError({
						operation: "addProfile",
						cause: error,
					}),
			});
			return wordActivation;
		}

		const profileDoc = findSubscribeEmail.docs[FIRST_INDEX];
		if (!profileDoc) {
			return yield* Effect.fail(
				new WordActivationFirestoreError({
					operation: "getOrAssignWordOfActivationEffect.subscriptionNotFound",
				}),
			);
		}
		const profileData = Schema.decodeUnknownSync(WordActivationSubSchema)({
			profileID: profileDoc.id,
			...profileDoc.data(),
		});

		const wordActivation = yield* getWordOfActivationByIdEffect(profileData.wordActivationId);
		// Change the monthly sub if it different from the doc
		if (profileData.monthlySub !== undefined && profileData.monthlySub !== sub) {
			yield* Effect.tryPromise({
				try: () => subscriptions.doc(profileData.profileID).update({ monthlySub: sub }),
				catch: (error) =>
					new WordActivationFirestoreError({
						operation: "updateMonthlySub",
						cause: error,
					}),
			});
		}

		if (!profileData.wordActivationId) {
			yield* Effect.tryPromise({
				try: () =>
					subscriptions
						.doc(profileData.profileID)
						.update({ wordActivationId: wordActivation.verseId }),
				catch: (error) =>
					new WordActivationFirestoreError({
						operation: "updateWordActivationId",
						cause: error,
					}),
			});
		}

		return wordActivation;
	});
