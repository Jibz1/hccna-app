import { Schema } from "effect";

import type { SavedVerseKind } from "@/db/schema/savedVerses";

export type { SavedVerseKind } from "@/db/schema/savedVerses";

/** Keeps one account's list, catalog lookups, and imports bounded. */
export const SAVED_VERSE_LIMIT = 500;

export interface SavedVerseRow {
	/** Scripture catalog key: the `wordActivationScriptures` document ID. */
	readonly verseId: string;
	readonly kind: SavedVerseKind;
	readonly savedAt: Date;
}

export interface SaveVerseInput {
	readonly firebaseUid: string;
	readonly verseId: string;
	readonly kind: SavedVerseKind;
}

export interface SavedVerseImportReport {
	readonly imported: number;
	readonly alreadySaved: number;
	readonly skipped: number;
}

export class SavedVerseStoreError extends Schema.TaggedError<SavedVerseStoreError>()(
	"SavedVerseStoreError",
	{ detail: Schema.String, cause: Schema.optional(Schema.Unknown) },
) {}

export class SavedVerseProfileUnavailableError extends Schema.TaggedError<SavedVerseProfileUnavailableError>()(
	"SavedVerseProfileUnavailableError",
	{ detail: Schema.String },
) {}

export class SavedVerseLimitError extends Schema.TaggedError<SavedVerseLimitError>()(
	"SavedVerseLimitError",
	{ limit: Schema.Number },
) {}
