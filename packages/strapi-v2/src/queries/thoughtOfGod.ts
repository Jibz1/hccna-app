import { Schema } from "effect";

import { Media, mediaUrl, Meta, Text } from "./shared";

import type { CmsThoughtOfGod } from "../records";

export const TOG_OPERATION = "StrapiV2ThoughtOfGod";
export const TOG_DOCUMENT = `query StrapiV2ThoughtOfGod {
  tog {
    Heading { title description featureImage { url } }
    TOGBlogs(pagination: { pageSize: 100 }) { Title Description BlogLink Thumbnail { url } }
    Youtube(pagination: { pageSize: 100 }) { YoutubeLink VideoName description Thumbname { url } }
  }
}`;

export const TogData = Schema.Struct({
	tog: Schema.NullOr(
		Schema.Struct({
			Heading: Meta,
			TOGBlogs: Schema.NullOr(
				Schema.Array(Schema.Struct({ Title: Text, Description: Text, BlogLink: Text, Thumbnail: Media })),
			),
			Youtube: Schema.NullOr(
				Schema.Array(
					Schema.Struct({ YoutubeLink: Text, VideoName: Text, description: Text, Thumbname: Media }),
				),
			),
		}),
	),
});

export const toThoughtOfGod = (data: typeof TogData.Type): CmsThoughtOfGod | null => {
	if (data.tog === null) {
		return null;
	}
	return {
		title: data.tog.Heading?.title ?? null,
		description: data.tog.Heading?.description ?? null,
		thumbnail: mediaUrl(data.tog.Heading?.featureImage ?? null),
		// Strapi 5 blogs have no date; the server already sends "" for a missing one.
		blogs: (data.tog.TOGBlogs ?? []).map((blog) => ({
			title: blog.Title,
			description: blog.Description,
			link: blog.BlogLink,
			date: null,
			thumbnail: mediaUrl(blog.Thumbnail),
		})),
		youtube: (data.tog.Youtube ?? []).map((video) => ({
			youtubeLink: video.YoutubeLink,
			title: video.VideoName,
			thumbnail: mediaUrl(video.Thumbname),
			body: video.description,
		})),
	};
};
