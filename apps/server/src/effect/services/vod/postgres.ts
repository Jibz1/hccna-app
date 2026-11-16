import { dailyVerses, scriptures } from "@/db/schema/scriptures";
import { type VerseOfTheDay } from "@/effect/services/vod/types";
import { VodFetchError } from "@/graphql/schema/scriptures/vodErrors";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { db as DrizzleDatabase } from "@/db";

interface VodPostgresDeps {
	db: typeof DrizzleDatabase;
}

/**
 * Postgres keeps a dated copy of each verse the rotation publishes to Firebase.
 * Reads are served from Firebase for now. This repository owns the
 * `scriptures` / `dailyVerses` tables for the VOD flow.
 */
export const createVodPostgresRepository = (deps: VodPostgresDeps) => {
	const { db } = deps;

	/** Resolve the scripture id for a verse, inserting it when it does not exist. */
	const getOrCreateScriptureId = Effect.fn("VodService.postgres.getOrCreateScriptureId")(function* (
		verse: VerseOfTheDay,
	) {
		const selectByVerseId = (detail: string) =>
			Effect.tryPromise({
				try: () =>
					db
						.select({ id: scriptures.id })
						.from(scriptures)
						.where(eq(scriptures.verseId, verse.verseId))
						.limit(1),
				catch: (error) => new VodFetchError({ detail, cause: error }),
			});

		const [existingScripture] = yield* selectByVerseId("Failed to fetch scripture for daily verse");
		if (existingScripture) {
			return existingScripture.id;
		}

		yield* Effect.tryPromise({
			try: () =>
				db
					.insert(scriptures)
					.values({
						id: crypto.randomUUID(),
						book: verse.book,
						stBook: verse.stBook,
						verseId: verse.verseId,
						text: verse.text,
						nltTranslation: verse.nltTranslation,
						images: verse.image ? [verse.image] : [],
					})
					.onConflictDoNothing({ target: scriptures.verseId }),
			catch: (error) =>
				new VodFetchError({
					detail: "Failed to create scripture for daily verse",
					cause: error,
				}),
		});

		const [createdOrExistingScripture] = yield* selectByVerseId(
			"Failed to verify scripture for daily verse",
		);
		if (!createdOrExistingScripture) {
			return yield* new VodFetchError({
				detail: "Unable to resolve scripture for daily verse",
			});
		}

		return createdOrExistingScripture.id;
	});

	/** Upsert the daily-verse row for the caller's VOD day pointing at the given scripture. */
	const persistDailyVerse = Effect.fn("VodService.postgres.persistDailyVerse")(function* (
		scriptureId: string,
		image: string | undefined,
		today: string,
	) {
		return yield* Effect.tryPromise({
			try: () =>
				db
					.insert(dailyVerses)
					.values({ date: today, scriptureId, image })
					.onConflictDoUpdate({
						target: dailyVerses.date,
						set: { date: today, scriptureId, image },
					}),
			catch: (error) =>
				new VodFetchError({
					detail: "Failed to persist daily verse",
					cause: error,
				}),
		});
	});

	return {
		getOrCreateScriptureId,
		persistDailyVerse,
	};
};
