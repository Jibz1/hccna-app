import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";

interface ThoughtOfGodPage {
	title: string;
	thumbnail: string;
	description: string;
	blogs: ThoughtOfBlog[];
	youtube: ThoughtOfGodYoutube[];
}

interface ThoughtOfBlog {
	title: string;
	description: string;
	link: string;
	date: string;
	thumbnail: string;
}

interface ThoughtOfGodYoutube {
	youtubeLink: string;
	title: string;
	thumbnail: string;
	body: string;
}

const ThoughtOfGodBlogSchema = builder.objectRef<ThoughtOfBlog>("ThoughtOfBlog").implement({
	fields: (t) => ({
		title: t.exposeString("title", {
			nullable: false,
		}),
		date: t.exposeString("date", {
			nullable: false,
		}),
		description: t.exposeString("description", {
			nullable: false,
		}),
		thumbnail: t.exposeString("thumbnail", {
			nullable: true,
		}),
		link: t.exposeString("link", {
			nullable: false,
		}),
	}),
});

const ThoughtOfGodYoutubeSchema = builder
	.objectRef<ThoughtOfGodYoutube>("ThoughtOfGodYoutube")
	.implement({
		fields: (t) => ({
			youtubeLink: t.exposeString("youtubeLink", {
				nullable: false,
			}),
			title: t.exposeString("title", {
				nullable: false,
			}),
			thumbnail: t.exposeString("thumbnail", {
				nullable: true,
			}),
			body: t.exposeString("body", {
				nullable: false,
			}),
		}),
	});

const ThoughtOfGodPageSchema = builder.objectRef<ThoughtOfGodPage>("ThoughtOfGodPage").implement({
	fields: (t) => ({
		title: t.exposeString("title", {
			nullable: false,
		}),
		thumbnail: t.exposeString("thumbnail", {
			nullable: true,
		}),
		description: t.exposeString("description", {
			nullable: false,
		}),
		blogs: t.field({
			type: t.listRef(ThoughtOfGodBlogSchema),
			resolve: (root) => root.blogs || [],
		}),
		youtube: t.field({
			type: [ThoughtOfGodYoutubeSchema],
			resolve: (root) => root.youtube || [],
		}),
	}),
});

builder.queryField("thoughtOfGod", (t) =>
	t.field({
		type: ThoughtOfGodPageSchema,
		authScopes: authScope.authorized,
		description: "Thought Of God",
		resolve: async (_, __, ctx) => {
			const record = await ctx.effect.runPromise(
				Effect.gen(function* () {
					const cms = yield* CmsContent;
					return yield* cms.thoughtOfGod;
				}),
			);

			if (record === null) {
				return { title: "", thumbnail: "", description: "", blogs: [], youtube: [] };
			}

			return {
				title: record.title || "",
				description: record.description || "",
				thumbnail: record.thumbnail || "",
				blogs: record.blogs
					.map((blog) => ({
						title: blog.title || "",
						description: blog.description || "",
						link: blog.link || "",
						date: blog.date || "",
						thumbnail: blog.thumbnail || "",
					}))
					.toReversed(),
				youtube: record.youtube
					.map((video) => ({
						youtubeLink: video.youtubeLink || "",
						title: video.title || "",
						thumbnail: video.thumbnail || "",
						body: video.body || "",
					}))
					.toReversed(),
			};
		},
	}),
);
