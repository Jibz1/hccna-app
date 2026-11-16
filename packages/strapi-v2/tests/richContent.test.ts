import { describe, expect, it } from "bun:test";

import { toRichContent } from "../src/richContent";

const doc = (...content: object[]) => ({ type: "doc", content });
const text = (value: string, marks?: object[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: object[]) => ({ type: "paragraph", content });
const editorJs = (...blocks: object[]) => ({ time: 1, blocks, version: "2.31.6" });

describe("toRichContent", () => {
	it("returns null when there is nothing to show", () => {
		expect(toRichContent(null)).toBeNull();
		expect(toRichContent(undefined)).toBeNull();
		expect(toRichContent("")).toBeNull();
		expect(toRichContent(doc())).toBeNull();
		expect(toRichContent(doc({ type: "paragraph" }, paragraph()))).toBeNull();
		expect(toRichContent(editorJs())).toBeNull();
	});

	it("passes Tiptap documents through without the CMS's preservation snapshot", () => {
		const value = {
			type: "doc",
			attrs: { schemaVersion: 1, legacyDocument: editorJs({ id: "a", type: "paragraph", data: { text: "Hi" } }) },
			content: [
				{
					type: "paragraph",
					attrs: { legacy: { id: "a", type: "paragraph", data: { text: "Hi" } }, quoteCaption: false },
					content: [text("Hi", [{ type: "bold" }])],
				},
				{ type: "bulletList", content: [{ type: "listItem", attrs: { legacy: {} }, content: [paragraph(text("One"))] }] },
			],
		};
		expect(toRichContent(value)).toEqual({
			type: "doc",
			attrs: { schemaVersion: 1 },
			content: [
				{ type: "paragraph", attrs: { quoteCaption: false }, content: [text("Hi", [{ type: "bold" }])] },
				{ type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("One"))] }] },
			],
		});
	});

	it("converts legacy EditorJS into the document the website renders", () => {
		const value = editorJs(
			{ id: "h", type: "header", data: { text: "Welcome", level: 2 } },
			{
				id: "p",
				type: "paragraph",
				data: { text: '<b>Bold</b> &amp; <a href="https://hccnj.org">link</a><br>next&nbsp;line' },
			},
			{
				id: "l",
				type: "list",
				data: {
					style: "ordered",
					meta: { start: 3 },
					items: [{ content: "One", meta: {}, items: [{ content: "One.a", meta: {}, items: [] }] }],
				},
			},
			{ id: "c", type: "checklist", data: { items: [{ text: "Done", checked: true }] } },
		);
		expect(toRichContent(value)).toEqual({
			type: "doc",
			attrs: { schemaVersion: 1 },
			content: [
				{ type: "heading", attrs: { level: 2 }, content: [text("Welcome")] },
				paragraph(
					text("Bold", [{ type: "bold" }]),
					text(" & "),
					text("link", [{ type: "link", attrs: { href: "https://hccnj.org", target: null, title: null } }]),
					{ type: "hardBreak" },
					text("next line"),
				),
				{
					type: "orderedList",
					attrs: { start: 3 },
					content: [
						{
							type: "listItem",
							content: [
								paragraph(text("One")),
								{
									type: "orderedList",
									attrs: { start: 1 },
									content: [{ type: "listItem", content: [paragraph(text("One.a"))] }],
								},
							],
						},
					],
				},
				{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph(text("Done"))] }] },
			],
		});
	});

	it("keeps old string list items", () => {
		const value = editorJs({ id: "l", type: "list", data: { style: "unordered", items: ["One", "<i>Two</i>"] } });
		expect(toRichContent(value)?.content).toEqual([
			{
				type: "bulletList",
				content: [
					{ type: "listItem", content: [paragraph(text("One"))] },
					{ type: "listItem", content: [paragraph(text("Two", [{ type: "italic" }]))] },
				],
			},
		]);
	});

	it("shows content it cannot convert as plain-text paragraphs", () => {
		const value = editorJs(
			{ id: "s", type: "paragraph", data: { text: '<span style="color:red">Red</span> text' } },
			{ id: "w", type: "warning", data: { title: "Note", message: "Be early" } },
			{ id: "m", type: "mediaLib", data: { name: "mediaLibraryStrapi" } },
		);
		expect(toRichContent(value)?.content).toEqual([
			paragraph(text("Red text")),
			paragraph(text("Note")),
			paragraph(text("Be early")),
		]);
	});

	it("shows the CMS's preserved legacy blocks as plain-text paragraphs", () => {
		const value = doc(
			{ type: "legacyBlock", attrs: { original: { id: "r", type: "raw", data: { html: "<p>Hello <b>there</b></p>" } } } },
			{ type: "legacyBlock", attrs: { original: { id: "e", type: "mediaLib", data: { name: "x" } } } },
		);
		expect(toRichContent(value)?.content).toEqual([paragraph(text("Hello there"))]);
	});

	it("converts legacy images to media figures and drops unsafe image URLs", () => {
		const value = editorJs(
			{ id: "i", type: "image", data: { file: { url: "https://img.example/a.png" }, caption: "Choir" } },
			{ id: "j", type: "image", data: { file: { url: "javascript:alert(1)" }, caption: "" } },
		);
		expect(toRichContent(value)?.content).toEqual([
			{
				type: "mediaFigure",
				attrs: {
					src: "https://img.example/a.png",
					alt: "Choir",
					title: null,
					withBorder: false,
					withBackground: false,
					stretched: false,
				},
				content: [text("Choir")],
			},
		]);
	});

	it("reads Strapi 4's EditorJS JSON strings", () => {
		const value = editorJs({ id: "p", type: "paragraph", data: { text: "From Strapi 4" } });
		expect(toRichContent(JSON.stringify(value))).toEqual(toRichContent(value));
		expect(toRichContent("Not JSON")?.content).toEqual([paragraph(text("Not JSON"))]);
	});

	it("never throws, and leaves unknown Tiptap nodes for the renderer to skip", () => {
		expect(toRichContent({ foo: "bar" })).toBeNull();
		const unknown = doc({ type: "mysteryWidget", content: [paragraph(text("inside"))] });
		expect(toRichContent(unknown)).toEqual(unknown);
	});
});
