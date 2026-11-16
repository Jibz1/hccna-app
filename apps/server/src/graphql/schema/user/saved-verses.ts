import {
	SAVED_VERSE_LIMIT,
	type SavedVerseImportReport,
	type SavedVerseKind,
	type SavedVerseRow,
} from "@/effect/services/savedVerses/model";
import { SavedVerseStore, type SavedVerseImportEntry } from "@/effect/services/SavedVerseStore";
import { ScriptureCatalog, type CatalogVerse } from "@/effect/services/ScriptureCatalog";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect, Option } from "effect";
import { GraphQLError } from "graphql";

import { UserRef } from "./index";

import type { GraphQLContext } from "@/graphql/context";

const MAX_IMPORT_BOOK_LENGTH = 200;
const MAX_IMPORT_TEXT_LENGTH = 2000;

interface SavedVerseView extends CatalogVerse {
	readonly kind: SavedVerseKind;
	readonly savedAt: Date;
}

interface SavedVerseImportInput {
	readonly book: string;
	readonly text: string;
	readonly kind: SavedVerseKind;
	readonly savedAt?: Date | null | undefined;
}

const badUserInput = (message: string, reason: string) =>
	new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT", reason } });

const profileUnavailable = () =>
	Effect.fail(
		new GraphQLError("Your profile is still being set up. Try again shortly.", {
			extensions: { code: "PROFILE_UNAVAILABLE" },
		}),
	);

const signedInUid = (
	ctx: Pick<GraphQLContext, "currentUserUid">,
): Effect.Effect<string, GraphQLError> =>
	ctx.currentUserUid
		? Effect.succeed(ctx.currentUserUid)
		: Effect.fail(
				new GraphQLError("Sign in to save verses", { extensions: { code: "UNAUTHENTICATED" } }),
			);

const toView = (row: SavedVerseRow, verse: CatalogVerse): SavedVerseView => ({
	...verse,
	kind: row.kind,
	savedAt: row.savedAt,
});

const listSavedVerses = Effect.fn("SavedVerses.list")(function* (firebaseUid: string) {
	const store = yield* SavedVerseStore;
	const catalog = yield* ScriptureCatalog;
	const rows = yield* store.list(firebaseUid);
	const verses = yield* catalog.getByIds(rows.map((row) => row.verseId));
	const saved = rows.flatMap((row) => {
		const verse = verses.get(row.verseId);
		return verse ? [toView(row, verse)] : [];
	});
	if (saved.length < rows.length) {
		yield* Effect.logWarning("Saved verses are missing from the scripture catalog").pipe(
			Effect.annotateLogs({ missing: rows.length - saved.length }),
		);
	}
	return saved;
});

const saveVerse = Effect.fn("SavedVerses.save")(
	function* (firebaseUid: string, verseId: string, kind: SavedVerseKind) {
		const catalog = yield* ScriptureCatalog;
		const store = yield* SavedVerseStore;
		const verse = yield* catalog.resolve(verseId);
		if (Option.isNone(verse)) {
			return yield* Effect.fail(
				badUserInput("This verse is not in the scripture catalog", "SCRIPTURE_NOT_FOUND"),
			);
		}
		const row = yield* store.save({ firebaseUid, verseId: verse.value.verseId, kind });
		return toView(row, verse.value);
	},
	Effect.catchTags({
		SavedVerseLimitError: (error) =>
			Effect.fail(badUserInput(`You can save up to ${error.limit} verses`, "SAVED_VERSE_LIMIT")),
		SavedVerseProfileUnavailableError: profileUnavailable,
	}),
);

const removeSavedVerse = Effect.fn("SavedVerses.remove")(function* (
	firebaseUid: string,
	verseId: string,
) {
	const catalog = yield* ScriptureCatalog;
	const store = yield* SavedVerseStore;
	// Saves are stored under the canonical ID; an unresolvable ID may still name an orphaned save.
	const canonicalId = Option.match(yield* catalog.resolve(verseId), {
		onNone: () => verseId,
		onSome: (verse) => verse.verseId,
	});
	const removed = yield* store.remove(firebaseUid, canonicalId);
	return { verseId: canonicalId, removed };
});

const importSavedVerses = Effect.fn("SavedVerses.import")(
	function* (firebaseUid: string, verses: readonly SavedVerseImportInput[]) {
		if (verses.length > SAVED_VERSE_LIMIT) {
			return yield* Effect.fail(
				badUserInput(`Import at most ${SAVED_VERSE_LIMIT} verses at a time`, "IMPORT_TOO_LARGE"),
			);
		}
		if (
			verses.some(
				(verse) =>
					verse.book.length > MAX_IMPORT_BOOK_LENGTH || verse.text.length > MAX_IMPORT_TEXT_LENGTH,
			)
		) {
			return yield* Effect.fail(badUserInput("A saved verse is too long", "IMPORT_TOO_LARGE"));
		}
		const catalog = yield* ScriptureCatalog;
		const store = yield* SavedVerseStore;
		const matches = yield* catalog.match(verses);
		const now = new Date();
		const entries: readonly SavedVerseImportEntry[] = verses.flatMap((verse, position) =>
			Option.match(matches[position] ?? Option.none(), {
				onNone: () => [],
				onSome: (verseId) => [
					{
						verseId,
						kind: verse.kind,
						savedAt: verse.savedAt && verse.savedAt <= now ? verse.savedAt : now,
					},
				],
			}),
		);
		const unmatched = verses.length - entries.length;
		if (unmatched > 0) {
			yield* Effect.logInfo("Saved verse import left entries unmatched").pipe(
				Effect.annotateLogs({ unmatched }),
			);
		}
		const report = yield* store.importMany(firebaseUid, entries);
		return { ...report, skipped: report.skipped + unmatched } satisfies SavedVerseImportReport;
	},
	Effect.catchTag("SavedVerseProfileUnavailableError", profileUnavailable),
);

const SavedVerseKindEnum = builder.enumType("SavedVerseKind", {
	description: "Where a saved verse was first saved from",
	values: {
		VERSE_OF_THE_DAY: { value: "verse-of-the-day" },
		WORD_OF_ACTIVATION: { value: "word-of-activation" },
	} as const,
});

const SavedVerseRef = builder.objectRef<SavedVerseView>("SavedVerse").implement({
	description: "Scripture the signed-in user saved to their account",
	fields: (t) => ({
		verseId: t.exposeID("verseId", {
			nullable: false,
			description: "Scripture catalog key (the wordActivationScriptures document ID)",
		}),
		kind: t.expose("kind", { type: SavedVerseKindEnum, nullable: false }),
		savedAt: t.expose("savedAt", { type: "DateTime", nullable: false }),
		book: t.exposeString("book", { nullable: false }),
		text: t.exposeString("text", { nullable: false, description: "NLT text" }),
		image: t.exposeString("image", { nullable: true }),
	}),
});

const RemoveSavedVersePayload = builder
	.objectRef<{ verseId: string; removed: boolean }>("RemoveSavedVersePayload")
	.implement({
		fields: (t) => ({
			verseId: t.exposeID("verseId", { nullable: false }),
			removed: t.exposeBoolean("removed", {
				nullable: false,
				description: "False when the verse was not saved",
			}),
		}),
	});

const ImportSavedVersesPayload = builder
	.objectRef<SavedVerseImportReport>("ImportSavedVersesPayload")
	.implement({
		fields: (t) => ({
			imported: t.exposeInt("imported", { nullable: false }),
			alreadySaved: t.exposeInt("alreadySaved", { nullable: false }),
			skipped: t.exposeInt("skipped", {
				nullable: false,
				description: "Entries with no catalog match, or beyond the saved verse limit",
			}),
		}),
	});

const SavedVerseImportInputRef = builder.inputType("SavedVerseImportInput", {
	description: "A verse saved on a device before saves were stored on the account",
	fields: (t) => ({
		book: t.string({ required: true }),
		text: t.string({ required: true }),
		kind: t.field({ type: SavedVerseKindEnum, required: true }),
		savedAt: t.field({ type: "DateTime", required: false }),
	}),
});

builder.objectField(UserRef, "savedVerses", (t) =>
	t.field({
		type: [SavedVerseRef],
		nullable: false,
		authScopes: authScope.signedIn,
		description: "Scripture the user saved, newest first",
		resolve: (_, __, ctx) =>
			ctx.effect.runPromise(signedInUid(ctx).pipe(Effect.flatMap(listSavedVerses))),
	}),
);

builder.mutationField("saveVerse", (t) =>
	t.field({
		type: SavedVerseRef,
		nullable: false,
		authScopes: authScope.signedIn,
		description:
			"Save a scripture to the caller's account. Saving an already saved verse returns the existing save.",
		args: {
			verseId: t.arg.id({ required: true }),
			kind: t.arg({ type: SavedVerseKindEnum, required: true }),
		},
		resolve: (_, { verseId, kind }, ctx) =>
			ctx.effect.runPromise(
				signedInUid(ctx).pipe(Effect.flatMap((uid) => saveVerse(uid, String(verseId), kind))),
			),
	}),
);

builder.mutationField("removeSavedVerse", (t) =>
	t.field({
		type: RemoveSavedVersePayload,
		nullable: false,
		authScopes: authScope.signedIn,
		description: "Remove a saved scripture from the caller's account",
		args: { verseId: t.arg.id({ required: true }) },
		resolve: (_, { verseId }, ctx) =>
			ctx.effect.runPromise(
				signedInUid(ctx).pipe(Effect.flatMap((uid) => removeSavedVerse(uid, String(verseId)))),
			),
	}),
);

builder.mutationField("importSavedVerses", (t) =>
	t.field({
		type: ImportSavedVersesPayload,
		nullable: false,
		authScopes: authScope.signedIn,
		description:
			"Add verses saved on a device to the caller's account. Existing saves are kept, so retries are safe.",
		args: { verses: t.arg({ type: [SavedVerseImportInputRef], required: true }) },
		resolve: (_, { verses }, ctx) =>
			ctx.effect.runPromise(
				signedInUid(ctx).pipe(Effect.flatMap((uid) => importSavedVerses(uid, verses))),
			),
	}),
);
