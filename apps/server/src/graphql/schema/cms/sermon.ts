import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { capitalizeText } from "@/utils/capitalizeText";
import { Effect, Result, Schema } from "effect";

import type { CmsSermon, CmsSermonCursor, CmsSermonPage, CmsSermonsQuery } from "@hccnj/strapi-v2";

// Define the sermon data structure
const SermonDataSchema = Schema.Struct({
	slug: Schema.String,
	title: Schema.String,
	date: Schema.String,
	thumbnail: Schema.optional(Schema.String),
	speakerFullName: Schema.optional(Schema.String),
	speakerImage: Schema.optional(Schema.String),
	youtubeLink: Schema.String,
	pageName: Schema.String,
});

type SermonData = typeof SermonDataSchema.Type;

// Define the sermon with ID for Relay
const SermonWithIdSchema = Schema.Struct({
	...SermonDataSchema.fields,
	id: Schema.String,
});

type SermonWithId = typeof SermonWithIdSchema.Type;

// Define the connection metadata
const SermonConnectionMetadataSchema = Schema.Struct({
	featuredImg: Schema.optional(Schema.String),
	body: Schema.optional(Schema.String),
});

type SermonConnectionMetadata = typeof SermonConnectionMetadataSchema.Type;

// Create the Sermon GraphQL type
const Sermon = builder.objectRef<SermonWithId>("Sermon").implement({
	fields: (t) => ({
		id: t.exposeID("id", {
			description: "Sermon ID",
		}),
		slug: t.exposeString("slug", {
			description: "Sermon slug",
		}),
		title: t.exposeString("title", {
			description: "Sermon title",
		}),
		date: t.exposeString("date", {
			description: "Sermon date",
		}),
		thumbnail: t.exposeString("thumbnail", {
			description: "Sermon thumbnail",
			nullable: true,
		}),
		speakerFullName: t.exposeString("speakerFullName", {
			description: "Sermon speaker full name",
			nullable: true,
		}),
		speakerImage: t.exposeString("speakerImage", {
			description: "Sermon speaker image",
			nullable: true,
		}),
		youtubeLink: t.exposeString("youtubeLink", {
			description: "Sermon youtube link",
		}),
		pageName: t.exposeString("pageName", {
			description: "Sermon page name",
		}),
	}),
});

// Create the SermonEdge type
const SermonEdge = builder
	.objectRef<{ node: SermonWithId; cursor: string }>("SermonEdge")
	.implement({
		fields: (t) => ({
			node: t.field({
				type: Sermon,
				resolve: (root) => root.node,
			}),
			cursor: t.exposeString("cursor", {
				description: "Cursor for pagination",
			}),
		}),
	});

// Create the PageInfo type
const PageInfo = builder
	.objectRef<{
		hasNextPage: boolean;
		hasPreviousPage: boolean;
		startCursor: string | null | undefined;
		endCursor: string | null | undefined;
	}>("PageInfo")
	.implement({
		fields: (t) => ({
			hasNextPage: t.exposeBoolean("hasNextPage", {
				description: "Whether there are more items after this page",
			}),
			hasPreviousPage: t.exposeBoolean("hasPreviousPage", {
				description: "Whether there are more items before this page",
			}),
			startCursor: t.exposeString("startCursor", {
				description: "Cursor for the first item in this page",
				nullable: true,
			}),
			endCursor: t.exposeString("endCursor", {
				description: "Cursor for the last item in this page",
				nullable: true,
			}),
		}),
	});

// Create the SermonConnectionMetadata type
const SermonConnectionMetadataType = builder
	.objectRef<SermonConnectionMetadata>("SermonConnectionMetadata")
	.implement({
		fields: (t) => ({
			featuredImg: t.exposeString("featuredImg", {
				description: "Featured image for the sermons page",
				nullable: true,
			}),
			body: t.exposeString("body", {
				description: "Body content for the sermons page",
				nullable: true,
			}),
		}),
	});

// Create the SermonConnection type with metadata
const SermonConnection = builder
	.objectRef<{
		edges: { node: SermonWithId; cursor: string }[];
		pageInfo: {
			hasNextPage: boolean;
			hasPreviousPage: boolean;
			startCursor: string | null | undefined;
			endCursor: string | null | undefined;
		};
		metadata: SermonConnectionMetadata;
	}>("SermonConnection")
	.implement({
		fields: (t) => ({
			edges: t.field({
				type: [SermonEdge],
				resolve: (root) => root.edges,
			}),
			pageInfo: t.field({
				type: PageInfo,
				resolve: (root) => root.pageInfo,
			}),
			metadata: t.field({
				type: SermonConnectionMetadataType,
				resolve: (root) => root.metadata,
			}),
		}),
	});

// Helper function to create cursor from sermon data
function createCursor(sermon: CmsSermonCursor): string {
	return Buffer.from(JSON.stringify({ slug: sermon.slug, date: sermon.date })).toString("base64");
}

// Helper function to parse cursor
const decodeCursor = Schema.decodeUnknownSync(
	Schema.fromJsonString(Schema.Struct({ slug: Schema.String, date: Schema.String })),
);

function parseCursor(cursor: string): CmsSermonCursor {
	return decodeCursor(Buffer.from(cursor, "base64").toString("utf8"));
}
/*
sermons: SermonData[],
	hasNextPage: boolean,
	hasPreviousPage: boolean,
	metadata: SermonConnectionMetadata,
*/
// Helper function to create connection from array
function createConnection({
	sermons,
	hasNextPage,
	hasPreviousPage,
	endCursor,
	metadata,
}: {
	sermons: SermonData[];
	hasNextPage: boolean;
	hasPreviousPage: boolean;
	endCursor: string | undefined;
	metadata: SermonConnectionMetadata;
}) {
	const edges = sermons.map((sermon) => ({
		node: { ...sermon, id: sermon.slug }, // Use slug as ID for Relay
		cursor: createCursor(sermon),
	}));

	return {
		edges,
		pageInfo: {
			hasNextPage,
			hasPreviousPage,
			// oxlint-disable-next-line no-null
			startCursor: edges.length > 0 ? edges?.[0]?.cursor : null,
			// oxlint-disable-next-line no-null
			endCursor: endCursor ?? (edges.length > 0 ? edges?.at(-1)?.cursor : null),
		},
		metadata,
	};
}

interface SermonRow {
	/** Undefined when the CMS row is missing a field the schema requires. */
	readonly sermon: SermonData | undefined;
	/** Undefined when the CMS row has no date to page from. */
	readonly position: CmsSermonCursor | undefined;
}

function toSermonRow(sermon: CmsSermon): SermonRow {
	const decoded = Schema.decodeUnknownResult(SermonDataSchema)({
		slug: sermon.slug,
		title: sermon.title === null ? undefined : capitalizeText(sermon.title.trim()),
		date: sermon.date ?? undefined,
		thumbnail: sermon.thumbnail ?? undefined,
		speakerFullName: sermon.speaker?.fullName?.trim(),
		speakerImage: sermon.speaker?.image ?? undefined,
		youtubeLink: sermon.youtubeLink ?? undefined,
		pageName: sermon.pageName?.trim(),
	});
	return {
		sermon: Result.isSuccess(decoded) ? decoded.success : undefined,
		position: sermon.date === null ? undefined : { slug: sermon.slug, date: sermon.date },
	};
}

/** CMS requests one page may make while skipping sermons it cannot serve. */
const MAX_CMS_BATCHES = 5;

/**
 * Reads CMS rows from `first` onward until the page holds `limit` servable sermons, skipping
 * rows that fail validation. The mobile list only asks for more sermons when a page added rows,
 * so a page must not come back empty while older sermons remain.
 */
const fillPage = Effect.fn("GraphQL.sermons.fillPage")(function* (
	cms: CmsContent["Service"],
	query: Extract<CmsSermonsQuery, { kind: "page" }>,
	first: CmsSermonPage,
	limit: number,
) {
	const direction = query.before ? "before" : "after";
	const rows: SermonRow[] = [];
	let served = 0;
	let batch = first;
	for (let batches = 1; ; batches++) {
		for (const item of batch.items) {
			if (served === limit) {
				return { rows, hasNextPage: true };
			}
			const row = toSermonRow(item);
			rows.push(row);
			if (row.sermon) {
				served++;
			}
		}
		const next = rows.at(-1)?.position;
		if (batch.items.length < query.pageSize || next === undefined) {
			return { rows, hasNextPage: false };
		}
		if (batches === MAX_CMS_BATCHES) {
			return { rows, hasNextPage: true };
		}
		batch = yield* cms.sermons({ ...query, [direction]: next });
	}
});

// Main query field
builder.queryField("sermons", (t) =>
	t.field({
		type: SermonConnection,
		authScopes: authScope.authorized,
		description: "Get Sermons with Relay Connection Pagination",
		args: {
			slugs: t.arg.string({
				description: "Sermons slugs, comma separated",
				required: false,
			}),
			first: t.arg.int({
				description: "Number of items to return (max 100)",
				required: false,
			}),
			after: t.arg.string({
				description: "Cursor to start after",
				required: false,
			}),
			last: t.arg.int({
				description: "Number of items to return from the end (max 100)",
				required: false,
			}),
			before: t.arg.string({
				description: "Cursor to start before",
				required: false,
			}),
		},
		resolve: async (_, args, ctx) => {
			try {
				const { slugs, first, after, last, before } = args;

				// Validate arguments
				if (first && last) {
					throw new Error("Cannot specify both first and last");
				}
				if (after && before) {
					throw new Error("Cannot specify both after and before");
				}

				const limit = Math.min(first || last || 20, 100);

				const cursor = after ?? before;
				const direction = before ? "before" : "after";
				const query: CmsSermonsQuery = slugs
					? { kind: "slugs", slugs: slugs.split(",") }
					: {
							kind: "page",
							// +1 to check if there's a next page
							pageSize: limit + 1,
							[direction]: cursor ? parseCursor(cursor) : undefined,
						};

				const { page, rows, hasNextPage } = await ctx.effect.runPromise(
					Effect.gen(function* () {
						const cms = yield* CmsContent;
						const page = yield* cms.sermons(query);
						if (query.kind === "slugs") {
							return { page, rows: page.items.map(toSermonRow), hasNextPage: false };
						}
						return { page, ...(yield* fillPage(cms, query, page, limit)) };
					}),
				);

				// A page after a cursor can be empty when sermons are unpublished between page loads.
				const validatedSermons = rows.flatMap((row) => (row.sermon ? [row.sermon] : []));
				if (validatedSermons.length === 0 && !slugs && !cursor) {
					throw new Error("No sermons found");
				}

				const hasPreviousPage = !slugs && Boolean(cursor);

				// The next page starts after the last row this page covered, even when that row was
				// dropped.
				const lastRow = rows.at(-1)?.position;
				const endCursor = !slugs && lastRow ? createCursor(lastRow) : undefined;

				// Get metadata from first sermon if available
				const metadata: SermonConnectionMetadata = {
					featuredImg: page.featuredImg ?? undefined,
					body: page.body ?? undefined,
				};

				return createConnection({
					sermons: validatedSermons,
					hasNextPage,
					hasPreviousPage,
					endCursor,
					metadata,
				});
			} catch (error) {
				console.error("Error fetching sermons:", error);
				throw new Error("Error fetching sermons", { cause: error });
			}
		},
	}),
);
