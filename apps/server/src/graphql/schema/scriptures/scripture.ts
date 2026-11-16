import { builder } from "@/graphql/builder";

export interface ScriptureData {
	book: string;
	date: string;
	stBook: string;
	text: string;
	image?: string;
	verseId?: string;
	nlt_translation: string;
}

export const Scripture = builder.objectRef<ScriptureData>("Scripture").implement({
	fields: (t) => ({
		book: t.exposeString("book", {
			description: "The book name of the Bible verse",
		}),
		date: t.exposeString("date", {
			description: "The date for this verse",
		}),
		stBook: t.exposeString("stBook", {
			description: "Short book name or reference",
		}),
		text: t.exposeString("text", {
			description: "The actual verse text",
		}),
		image: t.exposeString("image", {
			nullable: true,
			description: "Optional image associated with the verse",
		}),
		verseId: t.exposeString("verseId", {
			nullable: true,
			description: "Unique identifier for the verse",
		}),
	}),
});
