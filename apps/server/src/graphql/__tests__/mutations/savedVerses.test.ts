import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { execute, parse, type ExecutionArgs } from "graphql";

const { schema } = await import("@/graphql/schema");
const { anonymous, createMockContext } = await import("../utils/test-context");
const { ScriptureCatalog } = await import("@/effect/services/ScriptureCatalog");
const { createFakeScriptureCatalog } =
	await import("@/effect/services/__tests__/scriptureCatalogFakes");
const { useSavedVersesTestDb } = await import("@/effect/services/__tests__/savedVersesTestDb");
const testDb = useSavedVersesTestDb();

interface SavedVerseResult {
	readonly verseId: string;
	readonly kind: string;
	readonly savedAt: string;
	readonly book: string;
	readonly text: string;
	readonly image: string | null;
}

const PSALM_TEXT = "The Lord is my shepherd; I have all that I need.";
const catalogDocuments = {
	"doc-psalm": {
		book: "Psalm 23:1",
		nlt_translation: PSALM_TEXT,
		text: "The LORD is my shepherd; I shall not want.",
		img: ["https://images.example/psalm.png"],
	},
	"doc-john": {
		book: "John 3:16",
		verseId: "John 3:16",
		nlt_translation: "For this is how God loved the world.",
		img: [],
	},
};

const SAVED_VERSES = `query SavedVerses {
	user { savedVerses { verseId kind savedAt book text image } }
}`;
const SAVE = `mutation SaveVerse($verseId: ID!, $kind: SavedVerseKind!) {
	saveVerse(verseId: $verseId, kind: $kind) { verseId kind book text image }
}`;
const REMOVE = `mutation RemoveSavedVerse($verseId: ID!) {
	removeSavedVerse(verseId: $verseId) { verseId removed }
}`;
const IMPORT = `mutation ImportSavedVerses($verses: [SavedVerseImportInput!]!) {
	importSavedVerses(verses: $verses) { imported alreadySaved skipped }
}`;

function setup(uid = "uid-a") {
	const { client, storeLayer, fillSaves } = testDb();
	const layer = Layer.mergeAll(
		storeLayer,
		Layer.succeed(ScriptureCatalog, createFakeScriptureCatalog(catalogDocuments).catalog),
	);
	const contextValue = createMockContext({
		currentUserUid: uid,
		currentUserEmail: `${uid}@example.com`,
		authorized: true,
		authType: "jwt",
		effectRunPromise: <A, E, R>(program: Effect.Effect<A, E, R>) =>
			Effect.runPromise(program.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>),
	});
	const run = async (source: string, variableValues?: ExecutionArgs["variableValues"]) =>
		await execute({ schema, document: parse(source), contextValue, variableValues });
	const savedVerses = async () => {
		const result = await run(SAVED_VERSES);
		expect(result.errors).toBeUndefined();
		const user = result.data?.user as { savedVerses: SavedVerseResult[] } | undefined;
		return user?.savedVerses ?? [];
	};
	return { client, fillSaves, run, savedVerses };
}

const firstError = (result: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["run"]>>) =>
	result.errors?.[0];

describe("saved verses access", () => {
	it.each([
		["savedVerses", SAVED_VERSES, {}],
		["saveVerse", SAVE, { verseId: "doc-psalm", kind: "VERSE_OF_THE_DAY" }],
		["removeSavedVerse", REMOVE, { verseId: "doc-psalm" }],
		["importSavedVerses", IMPORT, { verses: [] }],
	])("denies anonymous callers %s", async (_field, source, variableValues) => {
		const result = await execute({
			schema,
			document: parse(source),
			contextValue: anonymous(),
			variableValues,
		});

		expect(result.errors?.some((error) => error.message.includes("Not authorized"))).toBe(true);
	});
});

describe("saveVerse", () => {
	it("saves a verse and lists it with the catalog's text", async () => {
		const { run, savedVerses } = setup();

		const result = await run(SAVE, { verseId: "doc-psalm", kind: "VERSE_OF_THE_DAY" });

		expect(result.errors).toBeUndefined();
		expect(result.data?.saveVerse).toEqual({
			verseId: "doc-psalm",
			kind: "VERSE_OF_THE_DAY",
			book: "Psalm 23:1",
			text: PSALM_TEXT,
			image: "https://images.example/psalm.png",
		});
		const [saved] = await savedVerses();
		expect(saved).toMatchObject({ verseId: "doc-psalm", kind: "VERSE_OF_THE_DAY" });
		const savedAt = Date.parse(String(saved?.savedAt));
		expect(Number.isNaN(savedAt)).toBe(false);
	});

	it("stores a verse identified by its verseId field under the document ID", async () => {
		const { run } = setup();

		const result = await run(SAVE, { verseId: "John 3:16", kind: "WORD_OF_ACTIVATION" });

		expect(result.data?.saveVerse).toMatchObject({ verseId: "doc-john", image: null });
	});

	it("rejects verses that are not in the scripture catalog", async () => {
		const { run } = setup();

		const result = await run(SAVE, { verseId: "doc-unknown", kind: "VERSE_OF_THE_DAY" });

		expect(firstError(result)?.extensions).toMatchObject({
			code: "BAD_USER_INPUT",
			reason: "SCRIPTURE_NOT_FOUND",
		});
	});

	it("rejects saves beyond the per-user limit", async () => {
		const { run, fillSaves } = setup();
		await fillSaves("user-a");

		const result = await run(SAVE, { verseId: "doc-psalm", kind: "VERSE_OF_THE_DAY" });

		expect(firstError(result)?.extensions).toMatchObject({
			code: "BAD_USER_INPUT",
			reason: "SAVED_VERSE_LIMIT",
		});
	});

	it("reports a profile that has not been created yet", async () => {
		const { run } = setup("uid-without-profile");

		const result = await run(SAVE, { verseId: "doc-psalm", kind: "VERSE_OF_THE_DAY" });

		expect(firstError(result)?.extensions).toMatchObject({ code: "PROFILE_UNAVAILABLE" });
	});
});

describe("user.savedVerses", () => {
	it("leaves out saves whose verse has left the catalog", async () => {
		const { client, run, savedVerses } = setup();
		await run(SAVE, { verseId: "doc-psalm", kind: "VERSE_OF_THE_DAY" });
		await client.query(
			`INSERT INTO saved_verses (user_id, verse_id, kind) VALUES ('user-a', 'doc-gone', 'verse-of-the-day')`,
		);

		const saved = await savedVerses();

		expect(saved.map((verse) => verse.verseId)).toEqual(["doc-psalm"]);
	});
});

describe("removeSavedVerse", () => {
	it("removes a save by the ID the client displayed", async () => {
		const { run, savedVerses } = setup();
		await run(SAVE, { verseId: "John 3:16", kind: "VERSE_OF_THE_DAY" });

		const result = await run(REMOVE, { verseId: "John 3:16" });

		expect(result.data?.removeSavedVerse).toEqual({ verseId: "doc-john", removed: true });
		expect(await savedVerses()).toEqual([]);
	});

	it("removes saves whose verse has left the catalog", async () => {
		const { client, run } = setup();
		await client.query(
			`INSERT INTO saved_verses (user_id, verse_id, kind) VALUES ('user-a', 'doc-gone', 'verse-of-the-day')`,
		);

		const result = await run(REMOVE, { verseId: "doc-gone" });

		expect(result.data?.removeSavedVerse).toEqual({ verseId: "doc-gone", removed: true });
	});

	it("reports when there was nothing to remove", async () => {
		const { run } = setup();

		const result = await run(REMOVE, { verseId: "doc-psalm" });

		expect(result.data?.removeSavedVerse).toEqual({ verseId: "doc-psalm", removed: false });
	});
});

describe("importSavedVerses", () => {
	it("imports matched saves with their original date and reports the rest", async () => {
		const { run, savedVerses } = setup();
		await run(SAVE, { verseId: "doc-john", kind: "VERSE_OF_THE_DAY" });

		const result = await run(IMPORT, {
			verses: [
				{
					book: "Psalm 23:1",
					text: ` ${PSALM_TEXT} `,
					kind: "WORD_OF_ACTIVATION",
					savedAt: "2026-01-02T03:04:05.000Z",
				},
				{
					book: "John 3:16",
					text: "For this is how God loved the world.",
					kind: "VERSE_OF_THE_DAY",
				},
				{ book: "Romans 8:28", text: "Not in the catalog", kind: "VERSE_OF_THE_DAY" },
			],
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.importSavedVerses).toEqual({ imported: 1, alreadySaved: 1, skipped: 1 });
		const saved = await savedVerses();
		const psalm = saved.find((verse) => verse.verseId === "doc-psalm");
		expect(psalm).toMatchObject({ kind: "WORD_OF_ACTIVATION" });
		expect(Date.parse(String(psalm?.savedAt))).toBe(Date.parse("2026-01-02T03:04:05.000Z"));
	});

	it("dates saves claiming a future time as now", async () => {
		const { run, savedVerses } = setup();

		await run(IMPORT, {
			verses: [
				{
					book: "Psalm 23:1",
					text: PSALM_TEXT,
					kind: "VERSE_OF_THE_DAY",
					savedAt: "2999-01-01T00:00:00.000Z",
				},
			],
		});

		const [saved] = await savedVerses();
		expect(Date.parse(String(saved?.savedAt))).toBeLessThanOrEqual(Date.now());
	});

	it("rejects imports that are too large", async () => {
		const { run } = setup();
		const entry = { book: "Psalm 23:1", text: PSALM_TEXT, kind: "VERSE_OF_THE_DAY" };

		const tooMany = await run(IMPORT, { verses: Array.from({ length: 501 }, () => entry) });
		const tooLong = await run(IMPORT, { verses: [{ ...entry, text: "a".repeat(2001) }] });

		expect(firstError(tooMany)?.extensions).toMatchObject({ code: "BAD_USER_INPUT" });
		expect(firstError(tooLong)?.extensions).toMatchObject({ code: "BAD_USER_INPUT" });
	});
});
