import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";

import { createFakeScriptureCatalog } from "./scriptureCatalogFakes";

const psalm = {
	book: "Psalm 23:1",
	nlt_translation: "The Lord is my shepherd;\nI have all that I need.",
	text: "The LORD is my shepherd; I shall not want.",
	img: ["https://images.example/psalm.png"],
	stBook: ["Ps"],
};
const john = {
	book: "John 3:16",
	verseId: "John 3:16",
	nlt_translation: "For this is how God loved the world: He gave his one and only Son.",
	text: "For God so loved the world.",
	img: [],
	stBook: ["Jn"],
};

const harness = createFakeScriptureCatalog;

describe("ScriptureCatalog.getByIds", () => {
	it("reads uncached verses in one batch, using the NLT text and first image", async () => {
		const { calls, catalog } = harness({ "doc-psalm": psalm, "doc-john": john });

		const verses = await Effect.runPromise(
			catalog.getByIds(["doc-psalm", "doc-john", "doc-psalm"]),
		);

		expect(verses.get("doc-psalm")).toEqual({
			verseId: "doc-psalm",
			book: "Psalm 23:1",
			text: "The Lord is my shepherd;\nI have all that I need.",
			image: "https://images.example/psalm.png",
		});
		expect(verses.get("doc-john")).toEqual({
			verseId: "doc-john",
			book: "John 3:16",
			text: john.nlt_translation,
		});
		expect(calls.readByIds).toEqual([["doc-psalm", "doc-john"]]);
	});

	it("serves repeat lookups from the cache", async () => {
		const { calls, catalog } = harness({ "doc-psalm": psalm });

		await Effect.runPromise(catalog.getByIds(["doc-psalm"]));
		const verses = await Effect.runPromise(catalog.getByIds(["doc-psalm"]));

		expect(verses.get("doc-psalm")?.book).toBe("Psalm 23:1");
		expect(calls.readByIds).toHaveLength(1);
	});

	it("leaves out unknown and malformed documents", async () => {
		const { catalog } = harness({ "doc-psalm": psalm, "doc-broken": { book: 42 } });

		const verses = await Effect.runPromise(
			catalog.getByIds(["doc-psalm", "doc-broken", "doc-gone"]),
		);

		expect([...verses.keys()]).toEqual(["doc-psalm"]);
	});

	it("never asks Firestore for IDs it cannot address", async () => {
		const { calls, catalog } = harness({ "doc-psalm": psalm });

		const verses = await Effect.runPromise(catalog.getByIds(["", "a/b", "..", "__id__"]));

		expect(verses.size).toBe(0);
		expect(calls.readByIds).toEqual([]);
	});
});

describe("ScriptureCatalog.resolve", () => {
	it("resolves a document ID", async () => {
		const { catalog } = harness({ "doc-psalm": psalm });

		const verse = await Effect.runPromise(catalog.resolve("doc-psalm"));

		expect(verse.pipe(Option.map((found) => found.verseId))).toEqual(Option.some("doc-psalm"));
	});

	it("falls back to a document whose verseId field matches, returning the document ID", async () => {
		const { catalog } = harness({ "doc-john": john });

		const verse = await Effect.runPromise(catalog.resolve("John 3:16"));

		expect(verse.pipe(Option.map((found) => found.verseId))).toEqual(Option.some("doc-john"));
	});

	it("returns none for an unknown ID", async () => {
		const { catalog } = harness({ "doc-psalm": psalm });

		const verse = await Effect.runPromise(catalog.resolve("doc-unknown"));

		expect(Option.isNone(verse)).toBe(true);
	});
});

describe("ScriptureCatalog.match", () => {
	it("matches saved text despite whitespace, quote, and case differences", async () => {
		const { catalog } = harness({
			"doc-quote": {
				...psalm,
				book: "Isaiah 40:31",
				nlt_translation: "“Those who trust in the Lord”",
			},
		});

		const matches = await Effect.runPromise(
			catalog.match([{ book: "isaiah 40:31", text: '  "those who trust in   the LORD"\n' }]),
		);

		expect(matches).toEqual([Option.some("doc-quote")]);
	});

	it("matches the source text field as well as the NLT text", async () => {
		const { catalog } = harness({ "doc-psalm": psalm });

		const matches = await Effect.runPromise(
			catalog.match([{ book: "Psalm 23:1", text: psalm.text }]),
		);

		expect(matches).toEqual([Option.some("doc-psalm")]);
	});

	it("prefers the document with the same book when the text is duplicated", async () => {
		const { catalog } = harness({
			"doc-a": { ...psalm, book: "Psalm 23:1 (copy)" },
			"doc-b": psalm,
		});

		const matches = await Effect.runPromise(
			catalog.match([{ book: "Psalm 23:1", text: psalm.nlt_translation }]),
		);

		expect(matches).toEqual([Option.some("doc-b")]);
	});

	it("falls back to a unique book when the text has since been edited", async () => {
		const { catalog } = harness({ "doc-psalm": psalm, "doc-john": john });

		const matches = await Effect.runPromise(
			catalog.match([{ book: "Psalm 23:1", text: "An older wording" }]),
		);

		expect(matches).toEqual([Option.some("doc-psalm")]);
	});

	it("leaves saves with no text or unique book match unmatched", async () => {
		const { catalog } = harness({
			"doc-a": psalm,
			"doc-b": { ...psalm, nlt_translation: "Another verse", text: "Another verse" },
		});

		const matches = await Effect.runPromise(
			catalog.match([
				{ book: "Psalm 23:1", text: "Edited wording" },
				{ book: "Romans 8:28", text: "Not in the catalog" },
			]),
		);

		expect(matches).toEqual([Option.none(), Option.none()]);
	});

	it("reads the whole catalog once for many entries and later calls", async () => {
		const { calls, catalog } = harness({ "doc-psalm": psalm, "doc-john": john });
		const entries = [
			{ book: "Psalm 23:1", text: psalm.nlt_translation },
			{ book: "John 3:16", text: john.nlt_translation },
		];

		await Effect.runPromise(catalog.match(entries));
		const again = await Effect.runPromise(catalog.match(entries));

		expect(again).toEqual([Option.some("doc-psalm"), Option.some("doc-john")]);
		expect(calls.readAll).toBe(1);
	});
});
