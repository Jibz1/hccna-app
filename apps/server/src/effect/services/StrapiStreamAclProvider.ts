import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { Context, Effect, Layer, Schema } from "effect";

import type { CmsStreamAcl } from "@hccnj/strapi-v2";

/**
 * Narrow CMS authorization adapter for stream editing (Phase A step 2 of
 * docs/streaming-migration-implementation-v3.md).
 *
 * Its only purpose is loading normalized stream ACL data. It owns coordinator
 * normalization (email trimming and lowercasing, `excludesIds` parsing) and the
 * error contract below. The queries, the special-slug-to-channel mapping and the
 * decoding of CMS responses live behind `CmsContent`, so the CMS transport schema
 * never becomes the application's authorization API. It does NOT decide anything
 * about a principal: matching a caller against coordinators stays with the
 * caller (moving to StreamAuthorizationService in step 3).
 */

class StreamAclSourceError extends Schema.TaggedError<StreamAclSourceError>()(
	"StreamAclSourceError",
	{
		campusSlug: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Stream ACL source read failed for slug ${this.campusSlug}`;
	}
}

class StreamAclMalformedError extends Schema.TaggedError<StreamAclMalformedError>()(
	"StreamAclMalformedError",
	{
		campusSlug: Schema.String,
		detail: Schema.String,
	},
) {
	override get message() {
		return `Stream ACL record malformed for slug ${this.campusSlug}: ${this.detail}`;
	}
}

class StreamAclMissingStreamError extends Schema.TaggedError<StreamAclMissingStreamError>()(
	"StreamAclMissingStreamError",
	{
		campusSlug: Schema.String,
	},
) {
	override get message() {
		return `No stream configured in Strapi for slug ${this.campusSlug}`;
	}
}

type StreamAclError = StreamAclSourceError | StreamAclMalformedError | StreamAclMissingStreamError;

interface StreamAclCoordinator {
	readonly normalizedEmail: string;
	readonly excludedPlatformIds: readonly string[];
	/**
	 * Under today's Strapi model every coordinator row can edit metadata; a
	 * finer-grained Strapi field would be interpreted here and only here.
	 */
	readonly canEditMetadata: boolean;
}

export interface StreamAclRecord {
	readonly campusSlug: string;
	readonly streamId: string;
	readonly coordinators: readonly StreamAclCoordinator[];
}

const parseExcludedPlatformIds = (excludeIDs: string | null | undefined): readonly string[] => [
	...new Set(
		(excludeIDs ?? "")
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean),
	),
];

const normalizeCoordinators = (
	rows: CmsStreamAcl["coordinators"],
): readonly StreamAclCoordinator[] =>
	rows.flatMap((row) => {
		const email = row.email?.trim().toLowerCase();
		if (!email) {
			return [];
		}
		return [
			{
				normalizedEmail: email,
				excludedPlatformIds: parseExcludedPlatformIds(row.excludesIds),
				canEditMetadata: true,
			},
		];
	});

interface StrapiStreamAclProviderContract {
	/**
	 * Source-fresh ACL read: bypasses the shared Strapi memory and Redis caches
	 * so a coordinator removed in Strapi loses access as soon as Strapi serves
	 * the updated record. Command authorization must never use a cached read.
	 */
	loadFreshBySlug: (campusSlug: string) => Effect.Effect<StreamAclRecord, StreamAclError>;
}

export class StrapiStreamAclProvider extends Context.Service<
	StrapiStreamAclProvider,
	StrapiStreamAclProviderContract
>()("StrapiStreamAclProvider", {
	make: Effect.gen(function* () {
		const content = yield* CmsContent;

		const loadFreshBySlug = Effect.fn("StrapiStreamAclProvider.loadFreshBySlug")(function* (
			campusSlug: string,
		) {
			const acl = yield* content
				.streamAcl(campusSlug)
				.pipe(
					Effect.mapError((error) =>
						error.reason === "Malformed"
							? new StreamAclMalformedError({ campusSlug, detail: error.detail })
							: new StreamAclSourceError({ campusSlug, cause: error }),
					),
				);
			// Fail closed on any falsy stream id: "" (an empty Castr ID) is no stream either.
			if (!acl?.streamId) {
				return yield* Effect.fail(new StreamAclMissingStreamError({ campusSlug }));
			}
			return {
				campusSlug,
				streamId: acl.streamId,
				coordinators: normalizeCoordinators(acl.coordinators),
			} satisfies StreamAclRecord;
		});

		return { loadFreshBySlug };
	}),
}) {}

export const StrapiStreamAclProviderLive = Layer.effect(
	StrapiStreamAclProvider,
	StrapiStreamAclProvider.make,
);
