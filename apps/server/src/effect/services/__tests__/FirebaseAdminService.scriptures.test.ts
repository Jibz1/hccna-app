import {
	makeWordActivationScriptureReads,
	type FirestoreDocumentData,
} from "@/effect/services/FirebaseAdminService";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";

type Documents = Readonly<Record<string, FirestoreDocumentData>>;

const snapshot = (entries: [string, FirestoreDocumentData][]) => ({
	docs: entries.map(([id, data]) => ({ id, data: () => data })),
});

function harness(documents: Documents) {
	const queries: string[] = [];
	const firestore: Parameters<typeof makeWordActivationScriptureReads>[0] = {
		collection: ((collection: string) => ({
			get: () => {
				queries.push(`${collection} all`);
				return Promise.resolve(snapshot(Object.entries(documents)));
			},
			where: (field: string, op: string, value: string) => ({
				limit: (count: number) => ({
					get: () => {
						queries.push(`${collection} ${field} ${op} ${value} limit ${count}`);
						const matches = Object.entries(documents).filter(([, data]) => data[field] === value);
						return Promise.resolve(snapshot(matches.slice(0, count)));
					},
				}),
			}),
		})) as never,
	};
	return {
		queries,
		reads: makeWordActivationScriptureReads(firestore, "wordActivationScriptures"),
	};
}

describe("FirebaseAdminService word activation scripture reads", () => {
	it("finds a scripture by the verseId stored on the document", async () => {
		const { queries, reads } = harness({
			"doc-1": { book: "John 3:16", verseId: "John 3:16" },
			"doc-2": { book: "Psalm 23:1" },
		});

		const found = await Effect.runPromise(reads.findWordActivationScriptureByVerseId("John 3:16"));

		expect(found).toEqual({ id: "doc-1", data: { book: "John 3:16", verseId: "John 3:16" } });
		expect(queries).toEqual(["wordActivationScriptures verseId == John 3:16 limit 1"]);
	});

	it("returns undefined when no document carries that verseId", async () => {
		const { reads } = harness({ "doc-1": { book: "John 3:16" } });

		expect(
			await Effect.runPromise(reads.findWordActivationScriptureByVerseId("missing")),
		).toBeUndefined();
	});

	it("lists every scripture with its document ID", async () => {
		const { queries, reads } = harness({
			"doc-1": { book: "John 3:16" },
			"doc-2": { book: "Psalm 23:1" },
		});

		const all = await Effect.runPromise(reads.listWordActivationScriptures);

		expect(all).toEqual([
			{ id: "doc-1", data: { book: "John 3:16" } },
			{ id: "doc-2", data: { book: "Psalm 23:1" } },
		]);
		expect(queries).toEqual(["wordActivationScriptures all"]);
	});
});
