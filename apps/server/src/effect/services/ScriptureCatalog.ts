import { LRUService } from "@/effect/LRUService";
import {
	FirebaseAdminService,
	type FirestoreDocumentData,
} from "@/effect/services/FirebaseAdminService";
import { Context, Effect, Layer, Option, Schema } from "effect";

/**
 * The scripture catalog is the `wordActivationScriptures` Firestore collection; Verse of the
 * Day and Word of Activation both draw from it. This service is the only code that knows
 * where catalog text lives, so a later move (Strapi, Postgres) replaces just the live layer.
 * Catalog IDs are the Firestore document IDs and must survive any such move.
 */
export interface CatalogVerse {
	readonly verseId: string;
	readonly book: string;
	/** NLT text, as Verse of the Day and Word of Activation display it. */
	readonly text: string;
	readonly image?: string;
}

/** A catalog document parsed at the storage boundary. */
interface ScriptureDocument {
	readonly id: string;
	readonly book: string;
	/** Display text: the NLT translation, else the source text. */
	readonly text: string;
	/** Every non-empty text the document carries, for matching saves made from either. */
	readonly texts: readonly string[];
	readonly image?: string;
}

export type ScriptureLookup =
	| { readonly _tag: "Found"; readonly document: ScriptureDocument }
	| { readonly _tag: "Malformed"; readonly id: string }
	| { readonly _tag: "Missing" };

export interface SavedTextReference {
	readonly book: string;
	readonly text: string;
}

export class ScriptureCatalogError extends Schema.TaggedError<ScriptureCatalogError>()(
	"ScriptureCatalogError",
	{ detail: Schema.String, cause: Schema.optional(Schema.Unknown) },
) {}

export interface ScriptureCatalogSource {
	/** Lookups aligned with `ids`. */
	readonly readByIds: (
		ids: readonly string[],
	) => Effect.Effect<readonly ScriptureLookup[], ScriptureCatalogError>;
	readonly findByVerseIdField: (
		verseId: string,
	) => Effect.Effect<ScriptureLookup, ScriptureCatalogError>;
	readonly readAll: Effect.Effect<readonly ScriptureLookup[], ScriptureCatalogError>;
}

/** Failures must be absorbed by the cache; a cold cache only costs a catalog read. */
export interface ScriptureCatalogCache {
	readonly get: <T>(key: string) => Effect.Effect<Option.Option<T>>;
	readonly set: <T>(key: string, value: T, ttlMs: number) => Effect.Effect<void>;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_ID_LENGTH = 1500;
const INDEX_KEY = "scripture-catalog:index";
const verseKey = (id: string) => `scripture-catalog:verse:${id}`;

const CatalogDocumentSchema = Schema.Struct({
	book: Schema.String,
	nlt_translation: Schema.optional(Schema.String),
	text: Schema.optional(Schema.String),
	img: Schema.optional(Schema.Array(Schema.String)),
});
const decodeDocument = Schema.decodeUnknownOption(CatalogDocumentSchema);

const MISSING: ScriptureLookup = { _tag: "Missing" };

/** Parses one `wordActivationScriptures` document into what the catalog can show. */
export const parseScriptureDocument = (
	id: string,
	data: FirestoreDocumentData,
): ScriptureLookup => {
	const malformed: ScriptureLookup = { _tag: "Malformed", id };
	return Option.match(decodeDocument(data), {
		onNone: () => malformed,
		onSome: (decoded) => {
			const book = decoded.book.trim();
			const texts = [decoded.nlt_translation, decoded.text]
				.map((text) => text?.trim() ?? "")
				.filter(Boolean);
			const [text] = texts;
			if (!book || !text) {
				return malformed;
			}
			const image = (decoded.img ?? []).map((url) => url.trim()).find(Boolean);
			const document = image ? { id, book, text, texts, image } : { id, book, text, texts };
			return { _tag: "Found", document };
		},
	});
};

const toCatalogVerse = ({ id, book, text, image }: ScriptureDocument): CatalogVerse =>
	image ? { verseId: id, book, text, image } : { verseId: id, book, text };

const foundDocuments = (lookups: readonly ScriptureLookup[]) =>
	lookups.flatMap((lookup) => (lookup._tag === "Found" ? [lookup.document] : []));

/** Firestore rejects these as document IDs; reading one would throw before any request. */
const isDocumentId = (id: string) =>
	id.length > 0 &&
	id.length <= MAX_ID_LENGTH &&
	!id.includes("/") &&
	id !== "." &&
	id !== ".." &&
	!/^__.*__$/u.test(id);

/** Compares saved and catalog text the way a reader would: ignoring case, spacing, and quote style. */
const normalize = (value: string) =>
	value
		.normalize("NFKC")
		.replaceAll(/[‘’‛′]/gu, "'")
		.replaceAll(/[“”‟″]/gu, '"')
		.replaceAll(/\s+/gu, " ")
		.trim()
		.toLowerCase();

interface IndexEntry {
	readonly verseId: string;
	readonly book: string;
	readonly texts: readonly string[];
}

const toIndexEntry = (document: ScriptureDocument): IndexEntry => ({
	verseId: document.id,
	book: normalize(document.book),
	texts: document.texts.map((text) => normalize(text)),
});

const matchEntry = (index: readonly IndexEntry[], saved: SavedTextReference) => {
	const book = normalize(saved.book);
	const text = normalize(saved.text);
	const sameText = index.filter((entry) => entry.texts.includes(text));
	if (sameText.length > 0) {
		const chosen = sameText.find((entry) => entry.book === book) ?? sameText[0];
		return Option.fromNullishOr(chosen?.verseId);
	}
	// The text may have been corrected since it was saved; a unique reference still identifies it.
	const sameBook = index.filter((entry) => entry.book === book);
	return sameBook.length === 1 ? Option.fromNullishOr(sameBook[0]?.verseId) : Option.none();
};

export const makeScriptureCatalog = (
	source: ScriptureCatalogSource,
	cache: ScriptureCatalogCache,
) => {
	const getByIds = Effect.fn("ScriptureCatalog.getByIds")(function* (
		ids: readonly string[],
	): Effect.fn.Return<ReadonlyMap<string, CatalogVerse>, ScriptureCatalogError> {
		const unique = [...new Set(ids)].filter((id) => isDocumentId(id));
		const cached = yield* Effect.all(unique.map((id) => cache.get<CatalogVerse>(verseKey(id))));
		const found = new Map(
			cached.flatMap((verse) => Option.toArray(verse)).map((verse) => [verse.verseId, verse]),
		);
		const missing = unique.filter((id) => !found.has(id));
		if (missing.length === 0) {
			return found;
		}
		const lookups = yield* source.readByIds(missing);
		const fetched = foundDocuments(lookups).map((document) => toCatalogVerse(document));
		yield* Effect.all(
			fetched.map((verse) => cache.set(verseKey(verse.verseId), verse, CACHE_TTL_MS)),
			{ discard: true },
		);
		for (const verse of fetched) {
			found.set(verse.verseId, verse);
		}
		const malformed = lookups.filter((lookup) => lookup._tag === "Malformed").length;
		if (malformed > 0) {
			yield* Effect.logWarning("Skipped malformed scripture catalog documents").pipe(
				Effect.annotateLogs({ malformed }),
			);
		}
		return found;
	});

	/** Canonicalizes a client-supplied ID: a document ID, else a document's `verseId` field. */
	const resolve = Effect.fn("ScriptureCatalog.resolve")(function* (
		id: string,
	): Effect.fn.Return<Option.Option<CatalogVerse>, ScriptureCatalogError> {
		if (id.length === 0 || id.length > MAX_ID_LENGTH) {
			return Option.none();
		}
		const byDocumentId = (yield* getByIds([id])).get(id);
		if (byDocumentId) {
			return Option.some(byDocumentId);
		}
		const lookup = yield* source.findByVerseIdField(id);
		return lookup._tag === "Found" ? Option.some(toCatalogVerse(lookup.document)) : Option.none();
	});

	const loadIndex = Effect.gen(function* () {
		const cached = yield* cache.get<readonly IndexEntry[]>(INDEX_KEY);
		if (Option.isSome(cached)) {
			return cached.value;
		}
		const lookups = yield* source.readAll;
		const index = foundDocuments(lookups)
			.map((document) => toIndexEntry(document))
			.toSorted((left, right) => left.verseId.localeCompare(right.verseId));
		yield* cache.set(INDEX_KEY, index, CACHE_TTL_MS);
		return index;
	});

	/** Finds catalog IDs for saves that only recorded their book and text. */
	const match = Effect.fn("ScriptureCatalog.match")(function* (
		saved: readonly SavedTextReference[],
	): Effect.fn.Return<readonly Option.Option<string>[], ScriptureCatalogError> {
		if (saved.length === 0) {
			return [];
		}
		const index = yield* loadIndex;
		return saved.map((entry) => matchEntry(index, entry));
	});

	return { getByIds, resolve, match };
};

export class ScriptureCatalog extends Context.Service<
	ScriptureCatalog,
	ReturnType<typeof makeScriptureCatalog>
>()("ScriptureCatalog") {}

const toCatalogError = (detail: string) => (cause: unknown) =>
	new ScriptureCatalogError({ detail, cause });

const parseFound = (id: string, data: FirestoreDocumentData | undefined) =>
	data === undefined ? MISSING : parseScriptureDocument(id, data);

export const ScriptureCatalogLive = Layer.effect(
	ScriptureCatalog,
	Effect.gen(function* () {
		const firebase = yield* FirebaseAdminService;
		const lru = yield* LRUService;
		const collection = firebase.collections.wordActivationScriptures;
		const source: ScriptureCatalogSource = {
			readByIds: (ids) =>
				firebase.batchReadDocuments(collection, ids).pipe(
					Effect.map((documents) => ids.map((id, position) => parseFound(id, documents[position]))),
					Effect.mapError(toCatalogError("Unable to read scriptures")),
				),
			findByVerseIdField: (verseId) =>
				firebase.findWordActivationScriptureByVerseId(verseId).pipe(
					Effect.map((entry) => (entry ? parseScriptureDocument(entry.id, entry.data) : MISSING)),
					Effect.mapError(toCatalogError("Unable to find scripture")),
				),
			readAll: firebase.listWordActivationScriptures.pipe(
				Effect.map((entries) =>
					entries.map((entry) => parseScriptureDocument(entry.id, entry.data)),
				),
				Effect.mapError(toCatalogError("Unable to list scriptures")),
			),
		};
		const cache: ScriptureCatalogCache = {
			get: <T>(key: string) =>
				lru.get<T>(key).pipe(
					Effect.map((value) => Option.fromNullishOr(value)),
					Effect.catchTag("LRUError", (error) =>
						Effect.logWarning("Scripture catalog cache read failed").pipe(
							Effect.annotateLogs({ key: error.key }),
							Effect.as(Option.none<T>()),
						),
					),
				),
			set: (key, value, ttlMs) =>
				lru
					.set(key, value, ttlMs)
					.pipe(
						Effect.catchTag("LRUError", (error) =>
							Effect.logWarning("Scripture catalog cache write failed").pipe(
								Effect.annotateLogs({ key: error.key }),
							),
						),
					),
		};
		return makeScriptureCatalog(source, cache);
	}),
);
