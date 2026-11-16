import { savedVerses } from "@/db/schema/savedVerses";
import { users } from "@/db/schema/users";
import { DrizzleService } from "@/effect/services/DrizzleService";
import {
	SAVED_VERSE_LIMIT,
	SavedVerseLimitError,
	SavedVerseProfileUnavailableError,
	SavedVerseStoreError,
	type SavedVerseImportReport,
	type SavedVerseKind,
	type SavedVerseRow,
	type SaveVerseInput,
} from "@/effect/services/savedVerses/model";
import { and, count, desc, eq, inArray, type AnyRelations } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export interface SavedVerseImportEntry {
	readonly verseId: string;
	readonly kind: SavedVerseKind;
	readonly savedAt: Date;
}

const rowSelection = {
	verseId: savedVerses.verseId,
	kind: savedVerses.kind,
	savedAt: savedVerses.savedAt,
};

/** Any Postgres drizzle database (node-postgres in production, PGlite in tests). */
export type SavedVerseDatabase = PgAsyncDatabase<PgQueryResultHKT, AnyRelations>;

const profileUnavailable = () =>
	new SavedVerseProfileUnavailableError({ detail: "User profile is unavailable" });

const query = <A>(detail: string, run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new SavedVerseStoreError({ detail, cause }) });

const profileIdOf = (executor: Pick<SavedVerseDatabase, "select">, firebaseUid: string) =>
	executor.select({ id: users.id }).from(users).where(eq(users.firebaseUid, firebaseUid));

export const makeSavedVerseStore = (db: SavedVerseDatabase) => {
	const list = Effect.fn("SavedVerseStore.list")(function* (firebaseUid: string) {
		const rows: readonly SavedVerseRow[] = yield* query("Unable to read saved verses", () =>
			db
				.select(rowSelection)
				.from(savedVerses)
				.innerJoin(users, eq(users.id, savedVerses.userId))
				.where(eq(users.firebaseUid, firebaseUid))
				.orderBy(desc(savedVerses.savedAt), savedVerses.verseId),
		);
		return rows;
	});

	const save = Effect.fn("SavedVerseStore.save")(function* (input: SaveVerseInput) {
		const outcome = yield* query("Unable to save verse", () =>
			db.transaction(async (tx) => {
				// Locking the profile row serializes this user's saves, so the limit holds.
				const [profile] = await profileIdOf(tx, input.firebaseUid).for("update");
				if (!profile) {
					return { _tag: "NoProfile" } as const;
				}
				const [existing] = await tx
					.select(rowSelection)
					.from(savedVerses)
					.where(and(eq(savedVerses.userId, profile.id), eq(savedVerses.verseId, input.verseId)));
				if (existing) {
					return { _tag: "Saved", row: existing } as const;
				}
				const [saved] = await tx
					.select({ total: count() })
					.from(savedVerses)
					.where(eq(savedVerses.userId, profile.id));
				if ((saved?.total ?? 0) >= SAVED_VERSE_LIMIT) {
					return { _tag: "Full" } as const;
				}
				const [row] = await tx
					.insert(savedVerses)
					.values({ userId: profile.id, verseId: input.verseId, kind: input.kind })
					.returning(rowSelection);
				return { _tag: "Saved", row } as const;
			}),
		);
		switch (outcome._tag) {
			case "NoProfile": {
				return yield* profileUnavailable();
			}
			case "Full": {
				return yield* new SavedVerseLimitError({ limit: SAVED_VERSE_LIMIT });
			}
			case "Saved": {
				if (!outcome.row) {
					return yield* new SavedVerseStoreError({ detail: "Saved verse was not returned" });
				}
				return outcome.row;
			}
		}
	});

	const remove = Effect.fn("SavedVerseStore.remove")(function* (
		firebaseUid: string,
		verseId: string,
	) {
		const owned = inArray(savedVerses.userId, profileIdOf(db, firebaseUid));
		const removed = yield* query("Unable to remove saved verse", () =>
			db
				.delete(savedVerses)
				.where(and(eq(savedVerses.verseId, verseId), owned))
				.returning({ verseId: savedVerses.verseId }),
		);
		return removed.length > 0;
	});

	/**
	 * Adds saves that are not already present, in order, until the limit is reached.
	 * Existing saves keep their kind and date, so retrying an import changes nothing.
	 */
	const importMany = Effect.fn("SavedVerseStore.importMany")(function* (
		firebaseUid: string,
		entries: readonly SavedVerseImportEntry[],
	) {
		const outcome = yield* query("Unable to import saved verses", () =>
			db.transaction(async (tx) => {
				const [profile] = await profileIdOf(tx, firebaseUid).for("update");
				if (!profile) {
					return { _tag: "NoProfile" } as const;
				}
				const existing = await tx
					.select({ verseId: savedVerses.verseId })
					.from(savedVerses)
					.where(eq(savedVerses.userId, profile.id));
				const known = new Set(existing.map((row) => row.verseId));
				const room = Math.max(0, SAVED_VERSE_LIMIT - known.size);
				const fresh = entries.filter((entry) => {
					if (known.has(entry.verseId)) {
						return false;
					}
					known.add(entry.verseId);
					return true;
				});
				const accepted = fresh.slice(0, room);
				if (accepted.length > 0) {
					await tx
						.insert(savedVerses)
						.values(accepted.map((entry) => ({ ...entry, userId: profile.id })))
						.onConflictDoNothing();
				}
				const report: SavedVerseImportReport = {
					imported: accepted.length,
					alreadySaved: entries.length - fresh.length,
					skipped: fresh.length - accepted.length,
				};
				return { _tag: "Imported", report } as const;
			}),
		);
		if (outcome._tag === "NoProfile") {
			return yield* profileUnavailable();
		}
		return outcome.report;
	});

	return { list, save, remove, importMany };
};

export class SavedVerseStore extends Context.Service<
	SavedVerseStore,
	ReturnType<typeof makeSavedVerseStore>
>()("SavedVerseStore") {}
export const SavedVerseStoreLive = Layer.effect(
	SavedVerseStore,
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		return makeSavedVerseStore(db);
	}),
);
