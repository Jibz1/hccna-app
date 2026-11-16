import { Schema } from "effect";

export const Text = Schema.NullOr(Schema.String);

export const Media = Schema.NullOr(Schema.Struct({ url: Schema.String }));

/** Strapi 5's `meta.meta` component (`Header`, `Heading`, `Intro`). */
export const Meta = Schema.NullOr(
	Schema.Struct({ title: Text, description: Text, featureImage: Media }),
);

export const mediaUrl = (media: typeof Media.Type): string | null => media?.url ?? null;

export const trimmedOrNull = (value: string | null): string | null => {
	const trimmed = value?.trim();
	return trimmed === undefined || trimmed === "" ? null : trimmed;
};
