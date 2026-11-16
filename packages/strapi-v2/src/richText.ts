import { Schema } from "effect";

/**
 * Strapi 5 stores rich text as JSON: untouched entries keep the legacy EditorJS
 * object, entries saved in the new admin hold a Tiptap document. The app's
 * EditorJsViewer renders EditorJS paragraph, header and list blocks from a JSON
 * string, so every value becomes that string.
 */
export const EDITOR_JS_VERSION = "2.31.0";

export class UnsupportedRichTextError extends Error {
	readonly nodeType: string;

	constructor(nodeType: string) {
		super(`Unsupported rich text node: ${nodeType}`);
		this.name = "UnsupportedRichTextError";
		this.nodeType = nodeType;
	}
}

interface TiptapMark {
	readonly type: string;
	readonly attrs?: { readonly [key: string]: unknown } | undefined;
}

interface TiptapNode {
	readonly type: string;
	readonly text?: string | undefined;
	readonly attrs?: { readonly [key: string]: unknown } | undefined;
	readonly marks?: readonly TiptapMark[] | undefined;
	readonly content?: readonly TiptapNode[] | undefined;
}

interface EditorJsBlock {
	readonly id?: string | undefined;
	readonly type: string;
	readonly data: unknown;
}

const Attrs = Schema.optional(Schema.Record(Schema.String, Schema.Unknown));
const TiptapMarkSchema = Schema.Struct({ type: Schema.String, attrs: Attrs });
const TiptapNodeSchema: Schema.Codec<TiptapNode> = Schema.Struct({
	type: Schema.String,
	text: Schema.optional(Schema.String),
	attrs: Attrs,
	marks: Schema.optional(Schema.Array(TiptapMarkSchema)),
	content: Schema.optional(
		Schema.Array(Schema.suspend((): Schema.Codec<TiptapNode> => TiptapNodeSchema)),
	),
});
const TiptapDocument = Schema.Struct({
	type: Schema.Literal("doc"),
	content: Schema.optional(Schema.Array(TiptapNodeSchema)),
});
const EditorJsDocument = Schema.Struct({ blocks: Schema.Array(Schema.Unknown) });
const LegacyBlock = Schema.Struct({ type: Schema.String, data: Schema.Unknown });
const BlockId = Schema.Struct({ id: Schema.String });
const ListData = Schema.Struct({ style: Schema.optional(Schema.String), items: Schema.Array(Schema.Unknown) });
const ListItemObject = Schema.Struct({
	content: Schema.optional(Schema.String),
	text: Schema.optional(Schema.String),
	items: Schema.optional(Schema.Array(Schema.Unknown)),
});
const HeadingLevel = Schema.Number;
const Href = Schema.String;

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);
const DROPPED_TYPES = new Set(["image", "table", "embed", "horizontalRule", "delimiter", "mediaFigure", "mediaEmbed", "attachment"]);
const MARK_TAGS: Readonly<Record<string, readonly [string, string]>> = {
	bold: ["<b>", "</b>"],
	italic: ["<i>", "</i>"],
	underline: ["<u>", "</u>"],
	strike: ["<s>", "</s>"],
	code: ['<code class="inline-code">', "</code>"],
	highlight: ['<mark class="cdx-marker">', "</mark>"],
	superscript: ["<sup>", "</sup>"],
	subscript: ["<sub>", "</sub>"],
};

const escapeHtml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const wrapMark = (html: string, mark: TiptapMark): string => {
	if (mark.type === "link") {
		const href = mark.attrs?.["href"];
		return Schema.is(Href)(href) ? `<a href="${escapeHtml(href).replaceAll('"', "&quot;")}">${html}</a>` : html;
	}
	const tags = MARK_TAGS[mark.type];
	if (tags === undefined) {
		throw new UnsupportedRichTextError(`mark:${mark.type}`);
	}
	return `${tags[0]}${html}${tags[1]}`;
};

const inlineHtml = (nodes: readonly TiptapNode[] | undefined): string =>
	(nodes ?? [])
		.map((node) => {
			if (node.type === "text") {
				return (node.marks ?? []).reduce(wrapMark, escapeHtml(node.text ?? ""));
			}
			if (node.type === "hardBreak") {
				return "<br>";
			}
			if (DROPPED_TYPES.has(node.type)) {
				return "";
			}
			throw new UnsupportedRichTextError(node.type);
		})
		.join("");

const blockToSegments = (node: TiptapNode): string[] => {
	if (DROPPED_TYPES.has(node.type)) {
		return [];
	}
	switch (node.type) {
		case "paragraph": {
			const text = inlineHtml(node.content);
			return text === "" ? [] : [text];
		}
		case "heading": {
			const text = inlineHtml(node.content);
			return text === "" ? [] : [text];
		}
		case "codeBlock": {
			const text = (node.content ?? [])
				.map((child) => (child.type === "text" ? escapeHtml(child.text ?? "") : ""))
				.join("");
			return text === "" ? [] : [text];
		}
		case "bulletList":
		case "orderedList":
		case "taskList": {
			return flatListItems(node);
		}
		case "blockquote": {
			return flatBlockquoteSegments(node);
		}
		case "legacyBlock": {
			return [];
		}
		default: {
			throw new UnsupportedRichTextError(node.type);
		}
	}
};

const flatBlockquoteSegments = (blockquote: TiptapNode): string[] => {
	const segments: string[] = [];
	for (const child of blockquote.content ?? []) {
		const childSegments = blockToSegments(child);
		segments.push(...childSegments);
	}
	return segments;
};

const flatListItems = (list: TiptapNode): string[] => {
	const items: string[] = [];
	const itemContainer = LIST_TYPES.has(list.type) ? list.content ?? [] : [];
	for (const item of itemContainer) {
		const children = item.content ?? [];
		const own: string[] = [];
		const nested: string[] = [];
		for (const child of children) {
			if (LIST_TYPES.has(child.type)) {
				nested.push(...flatListItems(child));
			} else {
				own.push(...blockToSegments(child));
			}
		}
		const ownText = own.join("<br>").replace(/(<br>)+$/, "").replace(/^(<br>)+/, "");
		if (ownText !== "") {
			items.push(ownText);
		}
		items.push(...nested);
	}
	return items;
};

const listItems = (list: TiptapNode): string[] => {
	return flatListItems(list);
};

const paragraphBlock = (html: string): EditorJsBlock[] =>
	html === "" ? [] : [{ type: "paragraph", data: { text: html } }];

const toBlocks = (node: TiptapNode): EditorJsBlock[] => {
	switch (node.type) {
		case "paragraph": {
			return paragraphBlock(inlineHtml(node.content));
		}
		case "heading": {
			const level = node.attrs?.["level"];
			return [
				{
					type: "header",
					data: { text: inlineHtml(node.content), level: Schema.is(HeadingLevel)(level) ? level : 2 },
				},
			];
		}
		case "bulletList":
		case "taskList": {
			return [{ type: "list", data: { style: "unordered", items: listItems(node) } }];
		}
		case "orderedList": {
			return [{ type: "list", data: { style: "ordered", items: listItems(node) } }];
		}
		case "blockquote": {
			const segments = flatBlockquoteSegments(node);
			const html = segments.join("<br>");
			return paragraphBlock(html);
		}
		case "codeBlock": {
			const text = (node.content ?? [])
				.map((child) => (child.type === "text" ? escapeHtml(child.text ?? "") : ""))
				.join("");
			return paragraphBlock(text);
		}
		case "legacyBlock": {
			const original = node.attrs?.["original"];
			return Schema.is(LegacyBlock)(original) ? [original] : [];
		}
		default: {
			if (DROPPED_TYPES.has(node.type)) {
				return [];
			}
			throw new UnsupportedRichTextError(node.type);
		}
	}
};

/** The newer EditorJS list tool saves `{ content, items }` objects; installed apps read strings. */
const flatListStrings = (items: readonly unknown[]): string[] =>
	items.flatMap((item) => {
		if (Schema.is(Schema.String)(item)) {
			return [item];
		}
		if (!Schema.is(ListItemObject)(item)) {
			return [];
		}
		const own = item.content ?? item.text ?? "";
		return [...(own === "" ? [] : [own]), ...flatListStrings(item.items ?? [])];
	});

/**
 * The shape installed apps render: editorjs-viewer-native keys blocks by `id`, and the app's list
 * renderer reads every item as a string.
 */
const appBlock = (block: unknown, index: number): unknown => {
	if (!Schema.is(LegacyBlock)(block)) {
		return block;
	}
	const withId = { id: Schema.is(BlockId)(block) ? block.id : `block-${index}`, ...block };
	if (block.type !== "list" || !Schema.is(ListData)(block.data) || block.data.items.every(Schema.is(Schema.String))) {
		return withId;
	}
	const style = block.data.style === "ordered" ? "ordered" : "unordered";
	return { ...withId, data: { style, items: flatListStrings(block.data.items) } };
};

export const toEditorJsString = (value: unknown): string | null => {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	if (Schema.is(Schema.String)(value)) {
		return value;
	}
	if (Schema.is(EditorJsDocument)(value)) {
		return JSON.stringify({ ...value, blocks: value.blocks.map(appBlock) });
	}
	if (Schema.is(TiptapDocument)(value)) {
		return JSON.stringify({
			time: 0,
			blocks: (value.content ?? []).flatMap(toBlocks).map(appBlock),
			version: EDITOR_JS_VERSION,
		});
	}
	throw new UnsupportedRichTextError("document");
};
