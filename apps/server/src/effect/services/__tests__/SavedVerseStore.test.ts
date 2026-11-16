import { SAVED_VERSE_LIMIT, type SavedVerseKind } from "@/effect/services/savedVerses/model";
import { SavedVerseStore } from "@/effect/services/SavedVerseStore";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";

import { useSavedVersesTestDb } from "./savedVersesTestDb";

const testDb = useSavedVersesTestDb();

function setup() {
	const { client, storeLayer, fillSaves } = testDb();
	const run = <A, E>(effect: Effect.Effect<A, E, SavedVerseStore>) =>
		Effect.runPromise(effect.pipe(Effect.provide(storeLayer)));
	return { client, run, fillSaves };
}

const save = (firebaseUid: string, verseId: string, kind: SavedVerseKind = "verse-of-the-day") =>
	SavedVerseStore.use((store) => store.save({ firebaseUid, verseId, kind }));
const list = (firebaseUid: string) => SavedVerseStore.use((store) => store.list(firebaseUid));

describe("SavedVerseStore", () => {
	it("lists a user's saves newest first", async () => {
		const { run } = setup();
		await run(save("uid-a", "verse-1"));
		await run(save("uid-a", "verse-2", "word-of-activation"));

		const saved = await run(list("uid-a"));

		expect(saved.map((row) => [row.verseId, row.kind])).toEqual([
			["verse-2", "word-of-activation"],
			["verse-1", "verse-of-the-day"],
		]);
		expect(saved[0]?.savedAt).toBeInstanceOf(Date);
	});

	it("keeps each account's saves separate", async () => {
		const { run } = setup();
		await run(save("uid-a", "verse-1"));

		expect(await run(list("uid-b"))).toEqual([]);
	});

	it("returns the existing save when a verse is saved again from another kind", async () => {
		const { run } = setup();
		const first = await run(save("uid-a", "verse-1", "word-of-activation"));

		const again = await run(save("uid-a", "verse-1", "verse-of-the-day"));

		expect(again).toEqual(first);
		expect(await run(list("uid-a"))).toHaveLength(1);
	});

	it("lists nothing for a signed-in user without a profile", async () => {
		const { run } = setup();

		expect(await run(list("uid-unknown"))).toEqual([]);
	});

	it("refuses to save without a profile", async () => {
		const { run } = setup();

		const error = await run(Effect.flip(save("uid-unknown", "verse-1")));

		expect(error._tag).toBe("SavedVerseProfileUnavailableError");
	});

	it("refuses saves beyond the per-user limit", async () => {
		const { run, fillSaves } = setup();
		await fillSaves("user-a");

		const error = await run(Effect.flip(save("uid-a", "one-too-many")));

		expect(error._tag).toBe("SavedVerseLimitError");
		// Re-saving an existing verse at the limit is still a no-op success.
		const existing = await run(save("uid-a", "bulk-1"));
		expect(existing.verseId).toBe("bulk-1");
	});

	it("removes a save and reports whether anything was removed", async () => {
		const { run } = setup();
		await run(save("uid-a", "verse-1"));
		const remove = SavedVerseStore.use((store) => store.remove("uid-a", "verse-1"));

		expect(await run(remove)).toBe(true);
		expect(await run(remove)).toBe(false);
		expect(await run(list("uid-a"))).toEqual([]);
	});

	it("imports new saves, keeps existing ones, and skips entries beyond the limit", async () => {
		const { run, fillSaves } = setup();
		await run(save("uid-a", "verse-1", "word-of-activation"));
		await fillSaves("user-a", SAVED_VERSE_LIMIT - 3);
		const savedAt = new Date("2026-01-02T03:04:05.000Z");

		const report = await run(
			SavedVerseStore.use((store) =>
				store.importMany("uid-a", [
					{ verseId: "verse-1", kind: "verse-of-the-day", savedAt },
					{ verseId: "verse-2", kind: "verse-of-the-day", savedAt },
					{ verseId: "verse-2", kind: "word-of-activation", savedAt },
					{ verseId: "verse-3", kind: "word-of-activation", savedAt },
					{ verseId: "verse-4", kind: "verse-of-the-day", savedAt },
				]),
			),
		);

		expect(report).toEqual({ imported: 2, alreadySaved: 2, skipped: 1 });
		const saved = await run(list("uid-a"));
		expect(saved.find((row) => row.verseId === "verse-1")?.kind).toBe("word-of-activation");
		expect(saved.find((row) => row.verseId === "verse-2")?.savedAt).toEqual(savedAt);
		expect(saved.some((row) => row.verseId === "verse-4")).toBe(false);
	});

	it("deletes a user's saves with the account", async () => {
		const { client, run } = setup();
		await run(save("uid-a", "verse-1"));

		await client.query(`DELETE FROM app_users WHERE id = 'user-a'`);

		const { rows } = await client.query(`SELECT count(*)::int AS n FROM saved_verses`);
		expect(rows).toEqual([{ n: 0 }]);
	});

	it("rejects kinds the app does not know", async () => {
		const { client } = setup();

		const insert = client.query(
			`INSERT INTO saved_verses (user_id, verse_id, kind) VALUES ('user-a', 'verse-1', 'sermon')`,
		);

		await expect(insert).rejects.toThrow();
	});
});
