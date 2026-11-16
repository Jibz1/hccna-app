import { type FirestoreDocumentData } from "@/effect/services/FirebaseAdminService";
import {
	makeScriptureCatalog,
	parseScriptureDocument,
	type ScriptureCatalogCache,
	type ScriptureCatalogSource,
	type ScriptureLookup,
} from "@/effect/services/ScriptureCatalog";
import { Effect, Option } from "effect";

export type CatalogDocuments = Readonly<Record<string, FirestoreDocumentData>>;

const MISSING: ScriptureLookup = { _tag: "Missing" };

/** A catalog over in-memory documents (keyed by document ID) that records source reads. */
export function createFakeScriptureCatalog(documents: CatalogDocuments) {
	const calls = { readByIds: [] as string[][], findByVerseIdField: [] as string[], readAll: 0 };
	const stored = new Map<string, unknown>();
	const lookup = (id: string) => {
		const data = documents[id];
		return data === undefined ? MISSING : parseScriptureDocument(id, data);
	};
	const source: ScriptureCatalogSource = {
		readByIds: (ids) =>
			Effect.sync(() => {
				calls.readByIds.push([...ids]);
				return ids.map((id) => lookup(id));
			}),
		findByVerseIdField: (verseId) =>
			Effect.sync(() => {
				calls.findByVerseIdField.push(verseId);
				const id = Object.keys(documents).find((key) => documents[key]?.verseId === verseId);
				return id === undefined ? MISSING : lookup(id);
			}),
		readAll: Effect.sync(() => {
			calls.readAll += 1;
			return Object.keys(documents).map((id) => lookup(id));
		}),
	};
	const cache: ScriptureCatalogCache = {
		get: <T>(key: string) =>
			Effect.sync(() => Option.fromNullishOr(stored.get(key) as T | undefined)),
		set: (key, value) =>
			Effect.sync(() => {
				stored.set(key, value);
			}),
	};
	return { calls, catalog: makeScriptureCatalog(source, cache) };
}
