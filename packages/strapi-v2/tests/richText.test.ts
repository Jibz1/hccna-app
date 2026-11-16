import { describe, expect, it } from "bun:test";

import { EDITOR_JS_VERSION, toEditorJsString, UnsupportedRichTextError } from "../src/richText";

const doc = (...content: object[]) => ({ type: "doc", content });
const text = (value: string, marks?: object[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: object[]) => ({ type: "paragraph", content });
const parsedBlocks = (value: unknown) => JSON.parse(toEditorJsString(value) ?? "null").blocks;
// Content assertions ignore block ids; the "block ids" tests below cover them.
const blocksOf = (value: object) =>
	parsedBlocks(value).map(({ id: _id, ...block }: { id: string }) => block);

const thrownBy = (run: () => void) => {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error("expected a throw");
};

describe("toEditorJsString", () => {
	it("returns null for empty values", () => {
		expect(toEditorJsString(null)).toBeNull();
		expect(toEditorJsString(undefined)).toBeNull();
		expect(toEditorJsString("")).toBeNull();
	});

	it("passes legacy EditorJS objects through unchanged", () => {
		const legacy = { time: 1757537055329, blocks: [{ id: "a", type: "image", data: {} }], version: "2.28.2" };
		expect(toEditorJsString(legacy)).toBe(JSON.stringify(legacy));
	});

	it("passes an EditorJS string through unchanged", () => {
		const value = '{"time":1,"blocks":[],"version":"2.28.2"}';
		expect(toEditorJsString(value)).toBe(value);
	});

	it("converts paragraphs, marks, links and hard breaks", () => {
		const value = doc(
			paragraph(
				text("Hello ", [{ type: "bold" }]),
				text("world", [{ type: "italic" }, { type: "link", attrs: { href: "https://hccnj.org/?a=1&b=2" } }]),
				{ type: "hardBreak" },
				text("5 < 6 & 7"),
			),
		);
		const parsed = JSON.parse(toEditorJsString(value) ?? "null");
		expect(parsed.time).toBe(0);
		expect(parsed.version).toBe(EDITOR_JS_VERSION);
		expect(parsed.blocks).toEqual([
			{
				id: "block-0",
				type: "paragraph",
				data: {
					text: '<b>Hello </b><a href="https://hccnj.org/?a=1&amp;b=2"><i>world</i></a><br>5 &lt; 6 &amp; 7',
				},
			},
		]);
	});

	it("converts headings and skips empty paragraphs", () => {
		expect(blocksOf(doc({ type: "heading", attrs: { level: 3 }, content: [text("Title")] }, paragraph()))).toEqual([
			{ type: "header", data: { text: "Title", level: 3 } },
		]);
	});

	it("converts lists and flattens nested items", () => {
		const item = (...content: object[]) => ({ type: "listItem", content });
		const value = doc(
			{
				type: "bulletList",
				content: [
					item(paragraph(text("One")), { type: "orderedList", content: [item(paragraph(text("One.a")))] }),
					item(paragraph(text("Two"))),
				],
			},
			{ type: "orderedList", content: [item(paragraph(text("First")))] },
		);
		expect(blocksOf(value)).toEqual([
			{ type: "list", data: { style: "unordered", items: ["One", "One.a", "Two"] } },
			{ type: "list", data: { style: "ordered", items: ["First"] } },
		]);
	});

	it("turns blockquotes into paragraphs and keeps preserved legacy blocks", () => {
		const legacyBlock = { id: "x", type: "paragraph", data: { text: "kept" } };
		const value = doc(
			{ type: "blockquote", content: [paragraph(text("Quoted")), paragraph(text("Twice"))] },
			{ type: "legacyBlock", attrs: { original: legacyBlock } },
		);
		expect(blocksOf(value)).toEqual([
			{ type: "paragraph", data: { text: "Quoted<br>Twice" } },
			{ type: "paragraph", data: { text: "kept" } },
		]);
	});

	it("drops images, tables, embeds and rules the app cannot render", () => {
		const value = doc(
			{ type: "image", attrs: { src: "https://img" } },
			{ type: "table", content: [] },
			{ type: "embed", attrs: {} },
			{ type: "horizontalRule" },
			paragraph(text("Visible")),
		);
		expect(blocksOf(value)).toEqual([{ type: "paragraph", data: { text: "Visible" } }]);
	});

	it("rejects values that are neither EditorJS nor Tiptap", () => {
		expect(() => toEditorJsString({ foo: "bar" })).toThrow(UnsupportedRichTextError);
	});

	it("drops top-level mediaFigure, mediaEmbed, attachment and table nodes", () => {
		const value = doc(
			{ type: "mediaFigure", attrs: { src: "https://img" } },
			paragraph(text("First")),
			{ type: "mediaEmbed", attrs: { src: "https://embed" } },
			paragraph(text("Second")),
			{ type: "attachment", attrs: { id: "123" } },
			{ type: "table", content: [] },
			paragraph(text("Third")),
		);
		expect(blocksOf(value)).toEqual([
			{ type: "paragraph", data: { text: "First" } },
			{ type: "paragraph", data: { text: "Second" } },
			{ type: "paragraph", data: { text: "Third" } },
		]);
	});

	it("drops media nodes inside blockquotes and flattens content", () => {
		const value = doc(
			{ type: "blockquote", content: [paragraph(text("Quoted")), { type: "mediaFigure", attrs: { src: "https://img" } }, { type: "horizontalRule" }, paragraph(text("Again"))] },
		);
		expect(blocksOf(value)).toEqual([
			{ type: "paragraph", data: { text: "Quoted<br>Again" } },
		]);
	});

	it("converts blockquote containing heading and paragraph", () => {
		const value = doc(
			{ type: "blockquote", content: [{ type: "heading", attrs: { level: 2 }, content: [text("Title")] }, paragraph(text("Body"))] },
		);
		expect(blocksOf(value)).toEqual([
			{ type: "paragraph", data: { text: "Title<br>Body" } },
		]);
	});

	it("drops media from list items while keeping text", () => {
		const item = (...content: object[]) => ({ type: "listItem", content });
		const value = doc(
			{
				type: "bulletList",
				content: [
					item(paragraph(text("One")), { type: "mediaFigure", attrs: { src: "https://img" } }),
					item(paragraph(text("Two"))),
				],
			},
		);
		expect(blocksOf(value)).toEqual([
			{ type: "list", data: { style: "unordered", items: ["One", "Two"] } },
		]);
	});

	it("converts taskList with taskItems", () => {
		const taskItem = (...content: object[]) => ({ type: "taskItem", content, attrs: { checked: false } });
		const value = doc(
			{
				type: "taskList",
				content: [
					taskItem(paragraph(text("Buy"))),
					taskItem(paragraph(text("Sell"))),
				],
			},
		);
		expect(blocksOf(value)).toEqual([
			{ type: "list", data: { style: "unordered", items: ["Buy", "Sell"] } },
		]);
	});

	it("converts top-level codeBlock with escaped content", () => {
		const value = doc({ type: "codeBlock", content: [text("const x = 1 < 2;")] });
		expect(blocksOf(value)).toEqual([
			{ type: "paragraph", data: { text: "const x = 1 &lt; 2;" } },
		]);
	});

	it("rejects unknown node type at top level", () => {
		const error = thrownBy(() => toEditorJsString(doc({ type: "mystery" })));
		expect(error).toBeInstanceOf(UnsupportedRichTextError);
		expect((error as UnsupportedRichTextError).nodeType).toBe("mystery");
	});

	it("rejects unknown node nested inside blockquote", () => {
		const blockquote = { type: "blockquote", content: [{ type: "mystery" }] };
		const error = thrownBy(() => toEditorJsString(doc(blockquote)));
		expect(error).toBeInstanceOf(UnsupportedRichTextError);
		expect((error as UnsupportedRichTextError).nodeType).toBe("mystery");
	});

	it("rejects unknown node nested inside listItem", () => {
		const item = (...content: object[]) => ({ type: "listItem", content });
		const list = { type: "bulletList", content: [item({ type: "mystery" })] };
		const error = thrownBy(() => toEditorJsString(doc(list)));
		expect(error).toBeInstanceOf(UnsupportedRichTextError);
		expect((error as UnsupportedRichTextError).nodeType).toBe("mystery");
	});

	it("rejects unknown node nested inside paragraph", () => {
		const para = paragraph({ type: "mystery" });
		const error = thrownBy(() => toEditorJsString(doc(para)));
		expect(error).toBeInstanceOf(UnsupportedRichTextError);
		expect((error as UnsupportedRichTextError).nodeType).toBe("mystery");
	});
});

describe("toEditorJsString block ids", () => {
	// editorjs-viewer-native keys each block by its id, so a missing id is a duplicate React key.
	it("gives every converted block an id and keeps the ids preserved blocks already have", () => {
		const legacyBlock = { id: "x", type: "paragraph", data: { text: "kept" } };
		const value = doc(
			paragraph(text("One")),
			{ type: "legacyBlock", attrs: { original: legacyBlock } },
			paragraph(text("Two")),
		);
		expect(parsedBlocks(value).map((block: { id: string }) => block.id)).toEqual(["block-0", "x", "block-2"]);
	});

	it("gives legacy EditorJS blocks without an id one", () => {
		const legacy = {
			time: 1,
			blocks: [
				{ type: "paragraph", data: { text: "a" } },
				{ id: "b", type: "paragraph", data: { text: "b" } },
			],
			version: "2.31.6",
		};
		expect(parsedBlocks(legacy).map((block: { id: string }) => block.id)).toEqual(["block-0", "b"]);
	});
});

describe("toEditorJsString nested list items", () => {
	// Installed apps call string methods on every list item.
	it("flattens the newer EditorJS list tool's item objects into strings", () => {
		const legacy = {
			time: 1,
			version: "2.31.6",
			blocks: [
				{
					id: "l",
					type: "list",
					data: {
						style: "unordered",
						meta: {},
						items: [
							{ content: "Sunday", meta: {}, items: [{ content: "9am", meta: {}, items: [] }] },
							{ content: "Wednesday", meta: {}, items: [] },
						],
					},
				},
			],
		};
		expect(parsedBlocks(legacy)).toEqual([
			{ id: "l", type: "list", data: { style: "unordered", items: ["Sunday", "9am", "Wednesday"] } },
		]);
	});

	it("turns checklist items into unordered list items", () => {
		const legacy = {
			time: 1,
			version: "2.31.6",
			blocks: [
				{
					id: "c",
					type: "list",
					data: {
						style: "checklist",
						meta: {},
						items: [{ content: "Bring a Bible", meta: { checked: true }, items: [] }],
					},
				},
			],
		};
		expect(parsedBlocks(legacy)).toEqual([
			{ id: "c", type: "list", data: { style: "unordered", items: ["Bring a Bible"] } },
		]);
	});

	it("leaves string list items as they are", () => {
		const legacy = {
			time: 1,
			version: "2.28.2",
			blocks: [{ id: "s", type: "list", data: { style: "ordered", items: ["One", "Two"] } }],
		};
		expect(toEditorJsString(legacy)).toBe(JSON.stringify(legacy));
	});
});
