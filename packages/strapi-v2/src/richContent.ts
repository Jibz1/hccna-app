import { isTag, isText, type AnyNode } from "domhandler";
import { Schema } from "effect";
import { parseDocument } from "htmlparser2";

/**
 * The rich text document the app renders: the Tiptap JSON the Strapi 5 CMS saves, with legacy
 * EditorJS converted the way the website converts it.
 *
 * Ported from HCCNJ/site `packages/rich-text` (`toRichDocument`, `inlineContent`, `plainText`,
 * `safeUrl`) at 5b7d14d9e895, so the app and the website read the same tree. Local changes:
 * - the CMS's preservation snapshot (`attrs.legacyDocument`, `attrs.legacy`) is removed;
 * - preserved `legacyBlock` nodes become plain-text paragraphs (the website's LegacyContent
 *   fallback, done here so the app needs no HTML parser);
 * - Strapi 4's EditorJS JSON strings are parsed, and a document with nothing to show is null.
 */

export type RichAttrs = { readonly [key: string]: Schema.Json };
export type RichMark = { readonly type: string; readonly attrs?: RichAttrs };
export type RichNode = {
	readonly type: string;
	readonly text?: string;
	readonly attrs?: RichAttrs;
	readonly marks?: readonly RichMark[];
	readonly content?: readonly RichNode[];
};
export type RichDocument = { readonly type: "doc"; readonly attrs?: RichAttrs; readonly content: readonly RichNode[] };

const Attrs = Schema.optionalKey(Schema.Record(Schema.String, Schema.Json));
const RichMarkSchema = Schema.Struct({ type: Schema.String, attrs: Attrs });
const RichNodeSchema: Schema.Codec<RichNode> = Schema.Struct({
	type: Schema.String,
	text: Schema.optionalKey(Schema.String),
	attrs: Attrs,
	marks: Schema.optionalKey(Schema.Array(RichMarkSchema)),
	content: Schema.optionalKey(Schema.Array(Schema.suspend((): Schema.Codec<RichNode> => RichNodeSchema))),
});
/** Plain JSON, so records holding it survive the cache's JSON round trip. */
export const RichDocumentSchema: Schema.Codec<RichDocument> = Schema.Struct({
	type: Schema.Literal("doc"),
	attrs: Attrs,
	content: Schema.Array(RichNodeSchema),
});

/** A node while converting: legacy values are still unchecked JSON. */
interface DraftMark {
	readonly type: string;
	readonly attrs?: { readonly [key: string]: unknown };
}
interface DraftNode {
	readonly type: string;
	readonly text?: string;
	readonly attrs?: { readonly [key: string]: unknown };
	readonly marks?: readonly DraftMark[];
	readonly content?: readonly DraftNode[];
}

type JsonObject = { readonly [key: string]: unknown };

const isJsonObject = (value: unknown): value is JsonObject =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const isString = Schema.is(Schema.String);

const requireText = (value: unknown): string => {
	if (!isString(value)) {
		throw new Error("Missing text");
	}
	return value;
};

// ── Inline HTML in legacy text fields ──────────────────────────

const MARK_TYPES: Readonly<Record<string, string>> = {
	b: "bold",
	strong: "bold",
	i: "italic",
	em: "italic",
	u: "underline",
	s: "strike",
	strike: "strike",
	del: "strike",
	code: "code",
	mark: "highlight",
	sup: "superscript",
	sub: "subscript",
};
const LINK_ATTRIBUTES = new Set(["href", "target", "rel", "title"]);
const CLASS_ATTRIBUTE = new Set(["class"]);

const markFor = (name: string, attribs: Readonly<Record<string, string>>): DraftMark => {
	const type = MARK_TYPES[name];
	if (type !== undefined) {
		return { type };
	}
	if (name === "a") {
		return {
			type: "link",
			attrs: { href: attribs["href"] ?? "", target: attribs["target"] ?? null, title: attribs["title"] ?? null },
		};
	}
	if (name === "span" && attribs["class"] === "cdx-marker") {
		return { type: "highlight" };
	}
	if (name === "span" && attribs["class"] === "inline-code") {
		return { type: "code" };
	}
	throw new Error(`Unsupported inline element: ${name}`);
};

/** Parses HTML in old text fields without executing it; throws for markup it would have to drop. */
const inlineContent = (html: string): DraftNode[] => {
	const walk = (nodes: readonly AnyNode[], marks: readonly DraftMark[]): DraftNode[] =>
		nodes.flatMap((node): DraftNode[] => {
			if (isText(node)) {
				if (node.data === "") {
					return [];
				}
				return [marks.length > 0 ? { type: "text", text: node.data, marks } : { type: "text", text: node.data }];
			}
			if (!isTag(node)) {
				return [];
			}
			if (node.name === "br") {
				return [{ type: "hardBreak" }];
			}
			const mark = markFor(node.name, node.attribs);
			// Do not silently discard inline styles or data from a legacy plugin.
			const allowed = node.name === "a" ? LINK_ATTRIBUTES : CLASS_ATTRIBUTE;
			if (Object.keys(node.attribs).some((key) => !allowed.has(key))) {
				throw new Error("Unsupported inline attributes");
			}
			// Tiptap's code mark excludes other marks.
			if (marks.length > 0 && (mark.type === "code" || marks.some((existing) => existing.type === "code"))) {
				throw new Error("Unsupported code formatting combination");
			}
			return walk(node.children, [...marks.filter((existing) => existing.type !== mark.type), mark]);
		});
	return walk(parseDocument(html).children, []);
};

const plainText = (html: string): string => {
	const walk = (nodes: readonly AnyNode[]): string =>
		nodes
			.map((node) => {
				if (isText(node)) {
					return node.data;
				}
				if (!isTag(node)) {
					return "";
				}
				return node.name === "br" ? "\n" : walk(node.children);
			})
			.join("");
	return walk(parseDocument(html).children);
};

/** An http(s) or root-relative image URL; anything else is not rendered as an image. */
const safeImageUrl = (value: unknown): string | undefined => {
	if (!isString(value)) {
		return undefined;
	}
	const url = value.trim();
	// Control characters and spaces (U+0000–U+0020, U+007F) make browsers read a different URL.
	if (url === "" || [...url].some((char) => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f)) {
		return undefined;
	}
	// A root-relative path only: //host and /\host would be another site.
	return /^https?:\/\//iu.test(url) || /^\/(?![/\\])/u.test(url) ? url : undefined;
};

// ── Legacy EditorJS blocks ─────────────────────────────────────

const paragraphOf = (html: string): DraftNode => ({ type: "paragraph", content: inlineContent(html) });
const textOrEmpty = (value: unknown) => (isString(value) ? value : "");

const LIST_STYLES = new Set(["ordered", "unordered", "checklist"]);

const convertList = (data: JsonObject): DraftNode => {
	const items = data["items"];
	if (!Array.isArray(items) || items.length === 0) {
		throw new Error("Invalid list");
	}
	const style = data["style"];
	if (Boolean(style) && !(isString(style) && LIST_STYLES.has(style))) {
		throw new Error("Unknown list style");
	}
	const task = style === "checklist";
	const meta = isJsonObject(data["meta"]) ? data["meta"] : {};
	const listItems = items.map((item: unknown): DraftNode => {
		const object = isJsonObject(item) ? item : {};
		const text = isString(item) ? item : requireText(object["content"] ?? object["text"]);
		const nested = object["items"];
		const children = Array.isArray(nested) && nested.length > 0 ? [convertList({ style, items: nested })] : [];
		const content = [paragraphOf(text), ...children];
		if (!task) {
			return { type: "listItem", content };
		}
		const itemMeta = isJsonObject(object["meta"]) ? object["meta"] : {};
		return { type: "taskItem", attrs: { checked: Boolean(itemMeta["checked"] ?? object["checked"]) }, content };
	});
	if (task) {
		return { type: "taskList", content: listItems };
	}
	if (style === "ordered") {
		return { type: "orderedList", attrs: { start: meta["start"] ?? 1 }, content: listItems };
	}
	return { type: "bulletList", content: listItems };
};

const convertTable = (data: JsonObject): DraftNode | undefined => {
	const rows = data["content"];
	if (!Array.isArray(rows) || rows.length === 0) {
		return undefined;
	}
	const [first] = rows;
	if (!Array.isArray(first) || first.length === 0) {
		return undefined;
	}
	if (rows.some((row: unknown) => !Array.isArray(row) || row.length !== first.length)) {
		return undefined;
	}
	const headings = Boolean(data["withHeadings"]);
	return {
		type: "table",
		attrs: { stretched: Boolean(data["stretched"]) },
		content: rows.map((row: readonly unknown[], index) => ({
			type: "tableRow",
			content: row.map((cell) => ({
				type: headings && index === 0 ? "tableHeader" : "tableCell",
				content: [paragraphOf(requireText(cell))],
			})),
		})),
	};
};

/** The Tiptap node for a known EditorJS tool, or undefined when the block must be preserved. */
const convertKnownBlock = (type: unknown, data: JsonObject): DraftNode | undefined => {
	const file = isJsonObject(data["file"]) ? data["file"] : {};
	switch (type) {
		case "paragraph": {
			return paragraphOf(requireText(data["text"]));
		}
		case "header": {
			const level = data["level"];
			if (![1, 2, 3, 4, 5, 6].includes(Number(level)) || !Number.isInteger(level)) {
				return undefined;
			}
			return { type: "heading", attrs: { level }, content: inlineContent(requireText(data["text"])) };
		}
		case "list": {
			return convertList(data);
		}
		case "checklist": {
			return convertList({ ...data, style: "checklist" });
		}
		case "quote": {
			const caption = data["caption"];
			return {
				type: "blockquote",
				attrs: { alignment: data["alignment"] ?? "left" },
				content: [
					paragraphOf(requireText(data["text"])),
					...(caption ? [{ ...paragraphOf(requireText(caption)), attrs: { quoteCaption: true } }] : []),
				],
			};
		}
		case "delimiter": {
			return { type: "horizontalRule" };
		}
		case "image": {
			const src = requireText(file["url"] ?? data["url"]);
			if (safeImageUrl(src) === undefined) {
				return undefined;
			}
			const caption = textOrEmpty(data["caption"]);
			return {
				type: "mediaFigure",
				attrs: {
					src,
					alt: plainText(caption),
					title: file["name"] ?? null,
					withBorder: Boolean(data["withBorder"]),
					withBackground: Boolean(data["withBackground"]),
					stretched: Boolean(data["stretched"]),
				},
				content: inlineContent(caption),
			};
		}
		case "table": {
			return convertTable(data);
		}
		case "embed": {
			return {
				type: "mediaEmbed",
				attrs: {
					source: requireText(data["source"] ?? data["embed"]),
					embed: data["embed"] ?? "",
					service: data["service"] ?? "",
					width: data["width"] ?? null,
					height: data["height"] ?? null,
				},
				content: inlineContent(textOrEmpty(data["caption"])),
			};
		}
		case "code": {
			const code = data["code"];
			return { type: "codeBlock", content: code ? [{ type: "text", text: requireText(code) }] : [] };
		}
		case "attaches": {
			return {
				type: "attachment",
				attrs: {
					url: requireText(file["url"]),
					title: data["title"] ?? file["name"] ?? "Download attachment",
					size: file["size"] ?? null,
				},
			};
		}
		default: {
			return undefined;
		}
	}
};

const convertBlock = (block: unknown): DraftNode => {
	const preserved: DraftNode = { type: "legacyBlock", attrs: { original: block } };
	if (!isJsonObject(block) || !isJsonObject(block["data"])) {
		return preserved;
	}
	try {
		return convertKnownBlock(block["type"], block["data"]) ?? preserved;
	} catch {
		return preserved;
	}
};

// ── Output for the app ─────────────────────────────────────────

const LEGACY_TEXT_FIELDS = ["title", "text", "content", "caption", "code", "html", "items", "message"];

const legacyStrings = (value: unknown): string[] => {
	if (isString(value)) {
		return [plainText(value)];
	}
	if (Array.isArray(value)) {
		return value.flatMap(legacyStrings);
	}
	if (isJsonObject(value)) {
		return LEGACY_TEXT_FIELDS.flatMap((field) => legacyStrings(value[field]));
	}
	return [];
};

/** Readable text for content neither converter could represent; never raw HTML. */
const legacyParagraphs = (original: unknown): RichNode[] => {
	const data = isJsonObject(original) && "data" in original ? original["data"] : original;
	return legacyStrings(data)
		.filter((text) => text !== "")
		.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] }));
};

const LEGACY_ATTRIBUTES = new Set(["legacy", "legacyDocument"]);
const isJson = Schema.is(Schema.Json);

/** The attributes the app reads: without the preservation snapshot, and only JSON values. */
const appAttrs = (attrs: DraftNode["attrs"]): RichAttrs | undefined => {
	const kept = Object.entries(attrs ?? {}).filter(
		(entry): entry is [string, Schema.Json] => !LEGACY_ATTRIBUTES.has(entry[0]) && isJson(entry[1]),
	);
	return kept.length > 0 ? Object.fromEntries(kept) : undefined;
};

const appMark = (mark: DraftMark): RichMark => {
	const attrs = appAttrs(mark.attrs);
	return attrs === undefined ? { type: mark.type } : { type: mark.type, attrs };
};

const appNodes = (node: DraftNode): RichNode[] => {
	if (node.type === "legacyBlock") {
		return legacyParagraphs(node.attrs?.["original"]);
	}
	const attrs = appAttrs(node.attrs);
	return [
		{
			type: node.type,
			...(node.text === undefined ? {} : { text: node.text }),
			...(attrs === undefined ? {} : { attrs }),
			...(node.marks === undefined ? {} : { marks: node.marks.map((mark) => appMark(mark)) }),
			...(node.content === undefined ? {} : { content: node.content.flatMap((child) => appNodes(child)) }),
		},
	];
};

const storedValue = (value: unknown): unknown => {
	if (!isString(value)) {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

interface DraftDocument {
	readonly attrs?: { readonly [key: string]: unknown };
	readonly content: readonly DraftNode[];
}

const toDocument = (value: unknown): DraftDocument => {
	if (Schema.is(RichDocumentSchema)(value)) {
		return value;
	}
	if (isJsonObject(value) && Array.isArray(value["blocks"])) {
		return { attrs: { schemaVersion: 1 }, content: value["blocks"].map((block: unknown) => convertBlock(block)) };
	}
	// Unexpected values stay visible as text, never an empty document.
	return { attrs: { schemaVersion: 1 }, content: [{ type: "legacyBlock", attrs: { original: value } }] };
};

const isEmptyParagraph = (node: RichNode) => node.type === "paragraph" && (node.content ?? []).length === 0;

/** Never throws: content it cannot convert is kept as plain text, unknown Tiptap nodes are left to the renderer. */
export const toRichContent = (value: unknown): RichDocument | null => {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const document = toDocument(storedValue(value));
	const content = document.content.flatMap((node) => appNodes(node));
	if (content.every(isEmptyParagraph)) {
		return null;
	}
	const attrs = appAttrs(document.attrs);
	return attrs === undefined ? { type: "doc", content } : { type: "doc", attrs, content };
};
