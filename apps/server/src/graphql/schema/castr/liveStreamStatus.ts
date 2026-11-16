import { StreamProjectionStore } from "@/effect/services/StreamProjectionStore";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";

interface LiveStream {
	id: string;
	slug?: string | undefined;
	isLive: boolean;
	metadata?: { readonly title: string | undefined; readonly description: string | undefined };
}

interface LiveStreamStatusSuccess {
	_tag: "LiveStreamStatusSuccess";
	streams: readonly LiveStream[];
}

interface LiveStreamStatusFetchError {
	_tag: "LiveStreamStatusFetchError";
	message: string;
}

type LiveStreamStatusResult = LiveStreamStatusSuccess | LiveStreamStatusFetchError;

const LiveStreamType = builder.objectRef<LiveStream>("LiveStream").implement({
	fields: (t) => ({
		id: t.exposeID("id", { nullable: false, description: "The Castr stream ID" }),
		slug: t.exposeString("slug", {
			nullable: true,
			description: "The campus slug this stream belongs to, or null when it has no campus",
		}),
		isLive: t.exposeBoolean("isLive", { nullable: false }),
		title: t.string({
			nullable: true,
			description:
				"The stream's shared title, or null when unavailable. Legacy metadata may lag edits briefly.",
			resolve: (root, _, ctx) =>
				root.metadata
					? root.metadata.title
					: ctx.loaders.streamMetadata.load(root.id).then((metadata) => metadata?.title),
		}),
		description: t.string({
			nullable: true,
			description:
				"The stream's shared description, or null when unavailable. Legacy metadata may lag edits briefly.",
			resolve: (root, _, ctx) =>
				root.metadata
					? root.metadata.description
					: ctx.loaders.streamMetadata.load(root.id).then((metadata) => metadata?.description),
		}),
	}),
});

const LiveStreamStatusSuccessType = builder
	.objectRef<LiveStreamStatusSuccess>("LiveStreamStatusSuccess")
	.implement({
		fields: (t) => ({
			streams: t.field({
				type: [LiveStreamType],
				nullable: false,
				resolve: (root) => root.streams,
			}),
		}),
	});

const LiveStreamStatusFetchErrorType = builder
	.objectRef<LiveStreamStatusFetchError>("LiveStreamStatusFetchError")
	.implement({
		fields: (t) => ({ message: t.exposeString("message", { nullable: false }) }),
	});

const LiveStreamStatusResultType = builder.unionType("LiveStreamStatusResult", {
	types: [LiveStreamStatusSuccessType, LiveStreamStatusFetchErrorType],
	resolveType: (value) => value._tag,
});

const loadLiveStreamStatus = Effect.fn("GraphQL.liveStreamStatus")(function* (
	slug?: string | null,
): Effect.fn.Return<LiveStreamStatusResult, never, StreamProjectionStore> {
	const store = yield* StreamProjectionStore;
	const requestedSlug = slug?.trim().toLowerCase();
	return yield* store.getLiveStreams().pipe(
		Effect.map((streams): LiveStreamStatusResult => ({
			_tag: "LiveStreamStatusSuccess",
			streams: requestedSlug
				? streams.filter((stream) => stream.slug?.toLowerCase() === requestedSlug)
				: streams,
		})),
		Effect.catchTag("LiveStreamConfigReadError", (error) =>
			Effect.logError("Failed to load live stream status").pipe(
				Effect.annotateLogs({ operation: "liveStreamStatus", cause: String(error.cause) }),
				Effect.as<LiveStreamStatusFetchError>({
					_tag: "LiveStreamStatusFetchError",
					message: "Unable to load live stream status",
				}),
			),
		),
	);
});

builder.queryFields((t) => ({
	liveStreamStatus: t.field({
		type: LiveStreamStatusResultType,
		authScopes: authScope.authorized,
		description:
			"Get each stream's live status, title, and description with typed success and error responses",
		args: {
			slug: t.arg.string({
				required: false,
				description:
					"Optional campus slug. Returns only that campus's streams; an unknown slug returns none. Omitted, null, or blank slugs return every stream.",
			}),
		},
		resolve: (_, { slug }, ctx) => ctx.effect.runPromise(loadLiveStreamStatus(slug)),
	}),
}));
