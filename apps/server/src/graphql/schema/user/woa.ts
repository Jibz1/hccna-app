import { builder } from "../../builder";

import type { WordOfActivationData } from "@/effect/services/WordOfActivationService";

export const WordOfActivationRef = builder
	.objectRef<WordOfActivationData>("WordOfActivation")
	.implement({
		description: "Word of Activation for the current month",

		fields: (t) => ({
			book: t.exposeString("book", {
				description: "The book name of the Bible verse",
			}),
			month: t.exposeString("month", {
				description: "The month for this verse",
			}),
			name: t.exposeString("name", {
				description: "The name of the user",
			}),
			monthlySub: t.exposeBoolean("monthlySub", {
				description: "The monthly subscription status",
			}),
			email: t.exposeString("email", {
				description: "The email of the user",
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
