import { Schema } from "effect";

import type { FirestoreDocumentData } from "@/effect/services/FirebaseAdminService";
import type { ScriptureData } from "@/graphql/schema/scriptures/scripture";

/**
 * Normalized verse-of-the-day document as published to / read from the Firebase
 * `customVerse/verseOfTheDay` document.
 */
export interface VerseOfTheDay {
	book: string;
	stBook: string;
	text: string;
	nltTranslation: string;
	verseId: string;
	image?: string;
}

/** Raw, untyped Firebase document used when restoring the previous verse. */
export type RawVerseOfTheDayDocument = FirestoreDocumentData;

/** Shape of a scripture entry in the Firebase word-activation collection. */
export const FirebaseWordActivationVerseSchema = Schema.Struct({
	book: Schema.String,
	verseId: Schema.String,
	img: Schema.Array(Schema.String),
	stBook: Schema.Array(Schema.String),
	text: Schema.String,
	nlt_translation: Schema.String,
});
export type FirebaseWordActivationVerse = typeof FirebaseWordActivationVerseSchema.Type;

/** Envelope persisted in the LRU/Redis caches alongside freshness metadata. */
export interface CachedVodEntry {
	data: ScriptureData;
	cachedAt: number;
	date: string;
}
