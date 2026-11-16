import { getTodayDateString } from "@/effect/services/vod/constants";
import {
	readNonEmptyString,
	readOptionalImage,
	toVerseOfTheDayWritePayload,
	toFirebaseWordActivationVerse,
} from "@/effect/services/vod/transforms";
import {
	type VerseOfTheDay,
	type RawVerseOfTheDayDocument,
	type FirebaseWordActivationVerse,
} from "@/effect/services/vod/types";
import {
	VodFetchError,
	VodNotFoundError,
	VodSetError,
} from "@/graphql/schema/scriptures/vodErrors";
import { omitUndefined } from "@/utils/omitUndefined";
import { Effect, Option } from "effect";

import type {
	FirebaseFirestoreReadError,
	FirebaseFirestoreWriteError,
	FirestoreDocumentData,
} from "@/effect/services/FirebaseAdminService";

interface VodFirebaseDeps {
	readonly verseCollection: string;
	readonly verseDocId: string;
	readonly wordActivationCollection: string;
	readonly readDocument: (
		collection: string,
		docId: string,
	) => Effect.Effect<FirestoreDocumentData | undefined, FirebaseFirestoreReadError>;
	readonly findFirstByDocumentId: (
		collection: string,
		op: "<" | ">=",
		afterId: string,
	) => Effect.Effect<FirestoreDocumentData | undefined, FirebaseFirestoreReadError>;
	readonly generateDocumentId: (collection: string) => string;
	readonly writeDocument: (
		collection: string,
		docId: string,
		data: FirestoreDocumentData,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	readonly mergeDocument: (
		collection: string,
		docId: string,
		data: FirestoreDocumentData,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
	readonly deleteDocument: (
		collection: string,
		docId: string,
	) => Effect.Effect<void, FirebaseFirestoreWriteError>;
}

/**
 * Firebase is the source of truth for the verse of the day. This repository owns
 * the VOD-specific read/write/validation logic, delegating raw Firestore I/O to
 * the approved `FirebaseAdminService` primitives and returning typed VOD errors.
 */
export const createVodFirebaseRepository = (deps: VodFirebaseDeps) => {
	const {
		verseCollection,
		verseDocId,
		wordActivationCollection,
		readDocument,
		findFirstByDocumentId,
		generateDocumentId,
		writeDocument,
		mergeDocument,
		deleteDocument,
	} = deps;

	/** Read and validate the published verse of the day, normalizing its fields. */
	const getDailyVerse = Effect.gen(function* () {
		const raw = yield* readDocument(verseCollection, verseDocId).pipe(
			Effect.mapError(
				(error) =>
					new VodFetchError({
						detail: "Failed to fetch verse of the day from Firebase",
						cause: error.cause,
					}),
			),
		);

		if (!raw) {
			return yield* new VodNotFoundError({ resource: "verse of the day (Firebase)" });
		}

		const book = readNonEmptyString(raw.book);
		const verseId = readNonEmptyString(raw.verseId);
		const stBook = readNonEmptyString(raw.stBook) ?? verseId ?? book ?? "Unknown";
		const nltTranslation = readNonEmptyString(raw.nlt_translation) ?? readNonEmptyString(raw.text);
		const text = readNonEmptyString(raw.text) ?? nltTranslation;
		const image = readOptionalImage(raw.image);

		if (!book || !text || !nltTranslation) {
			return yield* new VodFetchError({
				detail: "Firebase verse of the day is missing required fields (book/text)",
			});
		}

		const today = getTodayDateString();
		const normalizedVerseId = verseId ?? `firebase-vod-${today}-${crypto.randomUUID().slice(0, 8)}`;

		return omitUndefined({
			book,
			stBook: stBook.slice(0, 20),
			text,
			nltTranslation,
			verseId: normalizedVerseId,
			image: image || undefined,
		}) satisfies VerseOfTheDay;
	}).pipe(Effect.withSpan("VodService.firebase.getDailyVerse"));

	/** Pick a pseudo-random scripture from the word-activation collection. */
	const getRandomWordActivationVerse = Effect.gen(function* () {
		const key = generateDocumentId(wordActivationCollection);

		const getQuote = (op: "<" | ">=") =>
			findFirstByDocumentId(wordActivationCollection, op, key).pipe(
				Effect.mapError(
					(error) =>
						new VodSetError({
							detail: "Failed to select word activation scripture from Firebase",
							cause: error.cause,
						}),
				),
				// Decode synchronously throws on a malformed document; capture it as a
				// typed VodSetError so it cannot defect the fiber past mapError.
				Effect.flatMap((raw) =>
					raw
						? Effect.try({
								try: () => toFirebaseWordActivationVerse(raw),
								catch: (cause) =>
									new VodSetError({
										detail: "Failed to decode word activation scripture from Firebase",
										cause,
									}),
							})
						: Effect.succeed(null),
				),
			);

		const verse = (yield* getQuote(">=")) ?? (yield* getQuote("<"));
		if (!verse) {
			return yield* new VodSetError({
				detail: "No word activation scripture is available for verse of the day",
			});
		}

		return verse;
	}).pipe(Effect.withSpan("VodService.firebase.getRandomWordActivationVerse"));

	/** Snapshot the currently published document so it can be restored on rollback. */
	const readExistingDailyVerse = Effect.gen(function* () {
		const raw = yield* readDocument(verseCollection, verseDocId).pipe(
			Effect.mapError(
				(error) =>
					new VodSetError({
						detail: "Failed to read existing verse of the day from Firebase",
						cause: error.cause,
					}),
			),
		);

		// oxlint-disable-next-line no-array-callback-reference -- Option.some, not Array.some.
		return raw ? Option.some(raw) : Option.none<RawVerseOfTheDayDocument>();
	}).pipe(Effect.withSpan("VodService.firebase.readExistingDailyVerse"));

	/** Publish a new verse of the day, merging into the existing document. */
	const publishDailyVerse = Effect.fn("VodService.firebase.publishDailyVerse")(function* (
		verse: FirebaseWordActivationVerse,
	) {
		const dailyVerse = toVerseOfTheDayWritePayload(verse);
		yield* mergeDocument(verseCollection, verseDocId, dailyVerse).pipe(
			Effect.mapError(
				(error) =>
					new VodSetError({
						detail: "Failed to update verse of the day in Firebase",
						cause: error.cause,
					}),
			),
		);
	});

	/** Restore (or delete) the previous document after a failed rotation. */
	const restoreDailyVerse = Effect.fn("VodService.firebase.restoreDailyVerse")(function* (
		previousDailyVerse: Option.Option<RawVerseOfTheDayDocument>,
	) {
		const restore = Option.isSome(previousDailyVerse)
			? writeDocument(verseCollection, verseDocId, previousDailyVerse.value)
			: deleteDocument(verseCollection, verseDocId);

		yield* restore.pipe(
			Effect.mapError(
				(error) =>
					new VodSetError({
						detail: "Failed to restore previous verse of the day in Firebase",
						cause: error.cause,
					}),
			),
		);
	});

	return {
		getDailyVerse,
		getRandomWordActivationVerse,
		publishDailyVerse,
		readExistingDailyVerse,
		restoreDailyVerse,
	};
};
