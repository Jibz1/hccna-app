import { FIRESTORE_DOCUMENT_ID_FIELD } from "@/effect/services/FirebaseAdminService";
import {
	FirebaseWordActivationVerseSchema,
	type CachedVodEntry,
	type VerseOfTheDay,
	type FirebaseWordActivationVerse,
} from "@/effect/services/vod/types";
import { omitUndefined } from "@/utils/omitUndefined";
import { Predicate, Schema } from "effect";

import type { ScriptureData } from "@/graphql/schema/scriptures/scripture";

/** Trim a value to a non-empty string, or `undefined` when it is blank/non-string. */
export const readNonEmptyString = <Input>(value: Input): string | undefined => {
	if (!Predicate.isString(value)) {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
};

/** Accept either a direct image string or the first entry of an image array. */
export const readOptionalImage = <Input>(value: Input): string | undefined => {
	const directImage = readNonEmptyString(value);
	if (directImage) {
		return directImage;
	}

	if (Array.isArray(value) && value.length > 0) {
		return readNonEmptyString(value[0]);
	}

	return undefined;
};

/** A cache entry is valid only when it is well-formed and dated to today. */
export const isValidCacheEntry = (entry: CachedVodEntry, today: string): boolean =>
	Boolean(entry.data && entry.data.book && entry.cachedAt > 0 && entry.date === today);

/** Map a normalized Firebase verse into the GraphQL-facing scripture shape. */
export const toScriptureData = (verse: VerseOfTheDay, today: string): ScriptureData =>
	omitUndefined({
		book: verse.book,
		date: today,
		stBook: verse.stBook,
		text: verse.nltTranslation,
		nlt_translation: verse.nltTranslation,
		verseId: verse.verseId,
		image: verse.image || undefined,
	});

/** Decode an unknown Firebase document into a typed word-activation verse. */
export const toFirebaseWordActivationVerse = <Input>(value: Input): FirebaseWordActivationVerse => {
	const raw = Predicate.isObject(value) ? value : {};
	const verseId =
		readNonEmptyString("verseId" in raw ? raw.verseId : undefined) ??
		readNonEmptyString(
			FIRESTORE_DOCUMENT_ID_FIELD in raw ? raw[FIRESTORE_DOCUMENT_ID_FIELD] : undefined,
		);

	return Schema.decodeUnknownSync(FirebaseWordActivationVerseSchema)(
		omitUndefined({
			...raw,
			verseId: verseId || undefined,
		}),
	);
};

/** Build the merge payload written to the Firebase verse-of-the-day document. */
export const toVerseOfTheDayWritePayload = (verse: FirebaseWordActivationVerse) => ({
	book: verse.book,
	stBook: verse.stBook.join(" , "),
	text: verse.nlt_translation,
	image: verse.img[0],
	verseId: verse.verseId,
	date: new Date().toDateString(),
});

/** Normalize a word-activation verse into the internal daily-verse document. */
export const toVerseOfTheDay = (verse: FirebaseWordActivationVerse): VerseOfTheDay =>
	omitUndefined({
		book: verse.book,
		stBook: verse.stBook.join(" , ").slice(0, 20),
		text: verse.nlt_translation,
		nltTranslation: verse.nlt_translation,
		verseId: verse.verseId,
		image: verse.img[0] || undefined,
	});
