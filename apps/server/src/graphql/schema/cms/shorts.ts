import { ShortsService, type ShortItem } from "@/effect/services/shorts/ShortsService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";

const ShortSchema = builder.objectRef<ShortItem>("Short").implement({
	description: "A YouTube Short for the app's shorts feed",
	fields: (t) => ({
		id: t.id({
			nullable: false,
			description: "Short ID",
			// Prefixed so it cannot collide with another type's id in a client's normalized store.
			resolve: (short) => `Short:${short.videoId}`,
		}),
		videoId: t.exposeString("videoId", { nullable: false, description: "YouTube video id" }),
		title: t.exposeString("title", { nullable: false }),
		channelTitle: t.exposeString("channelTitle", {
			nullable: false,
			description: "Name of the YouTube channel that posted the short",
		}),
		thumbnail: t.exposeString("thumbnail", {
			nullable: true,
			description: "YouTube thumbnail URL",
		}),
		curated: t.exposeBoolean("curated", {
			nullable: false,
			description: "True for a hand-picked short; clients play these first",
		}),
	}),
});

builder.queryField("shorts", (t) =>
	t.field({
		type: [ShortSchema],
		nullable: false,
		authScopes: authScope.authorized,
		description:
			"Shorts for the feed, hand-picked ones first and unshuffled; clients choose the order. Empty when none are available.",
		resolve: (_, __, ctx) =>
			ctx.effect.runPromise(
				Effect.gen(function* () {
					const shorts = yield* ShortsService;
					return yield* shorts.list;
				}),
			),
	}),
);
