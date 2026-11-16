import { CampusPushService } from "@/effect/services/CampusPushService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";

const CampusSubscriptionSyncResult = builder
	.objectRef<{ processed: number; failed: number }>("CampusSubscriptionSyncResult")
	.implement({
		fields: (t) => ({
			processed: t.exposeInt("processed", { nullable: false }),
			failed: t.exposeInt("failed", { nullable: false }),
		}),
	});

builder.mutationField("reconcileCampusSubscriptions", (t) =>
	t.field({
		type: CampusSubscriptionSyncResult,
		authScopes: authScope.googleInternal,
		description:
			"Retry a bounded batch of pending campus subscription changes. Called by Cloud Scheduler.",
		resolve: (_, __, ctx) =>
			ctx.effect.runPromise(
				CampusPushService.use((service) => service.reconcilePending()).pipe(
					Effect.withSpan("reconcileCampusSubscriptions.resolve"),
				),
			),
	}),
);
