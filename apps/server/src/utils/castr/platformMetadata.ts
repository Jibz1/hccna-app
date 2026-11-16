import { Option, Schema } from "effect";

import type { FirebaseCastrStream } from "@/utils/castr/index";

/**
 * Per-destination title and description overrides for a Castr stream.
 *
 * Stored on the projection document as `platformMetadata: { [platformId]: { title, description } }`,
 * a field the Castr poll never writes, so overrides survive reconciliation. A destination without
 * an entry uses the stream's shared title and description.
 */
const PlatformMetadataSchema = Schema.Struct({
	title: Schema.String,
	description: Schema.String,
});
export type PlatformMetadata = typeof PlatformMetadataSchema.Type;
type PlatformMetadataByPlatformId = Readonly<Record<string, PlatformMetadata>>;

const decodeStoredPlatformMetadata = Schema.decodeUnknownOption(
	Schema.Record(Schema.String, Schema.Unknown),
);
const isPlatformMetadata = Schema.is(PlatformMetadataSchema);

/** Decode the stored overrides; malformed entries read as "uses the shared values". */
export function decodePlatformMetadataByPlatformId(
	stream: Pick<FirebaseCastrStream, "platformMetadata">,
) {
	const stored = Option.getOrElse(
		decodeStoredPlatformMetadata(stream.platformMetadata),
		() => ({}),
	);
	return Object.fromEntries(
		Object.entries(stored).flatMap(([platformId, entry]) =>
			isPlatformMetadata(entry) ? [[platformId, entry] as const] : [],
		),
	) satisfies PlatformMetadataByPlatformId;
}

/**
 * Interpret a destination's requested override. GraphQL keeps omitted and
 * null input fields distinct, which is what keeps older app builds safe:
 * - both omitted (older builds): `undefined`, keep any saved override
 * - both null: `null`, clear the override and use the shared values
 * - both non-blank: the new override
 */
export function parseRequestedPlatformMetadata({
	title,
	description,
}: {
	title?: string | null | undefined;
	description?: string | null | undefined;
}): PlatformMetadata | null | undefined {
	if (title === undefined && description === undefined) {
		return undefined;
	}
	if (title === null && description === null) {
		// oxlint-disable-next-line no-null
		return null;
	}
	if (title?.trim() && description?.trim()) {
		return { title, description };
	}
	throw new Error("Destination title and description must both be set or both be cleared");
}

export const isSamePlatformMetadata = (
	left: PlatformMetadata | undefined,
	right: PlatformMetadata | undefined,
) => left?.title === right?.title && left?.description === right?.description;
