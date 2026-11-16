import { AppConfig } from "@/effect/AppConfig";
import { PgClient } from "@effect/sql-pg";
import { Clock, Context, Duration, Effect, Layer, Redacted, Schema } from "effect";
import { PersistedQueue } from "effect/persistence";
import { createHash } from "node:crypto";

export const OnboardingJobSchema = Schema.Struct({
	version: Schema.Literal(1),
	uid: Schema.String,
	email: Schema.String,
});
export type OnboardingJob = typeof OnboardingJobSchema.Type;

class OnboardingDatabaseConfigError extends Schema.TaggedError<OnboardingDatabaseConfigError>()(
	"OnboardingDatabaseConfigError",
	{ message: Schema.String },
) {}

// Repeated profile reads coalesce, but a later directory match can still trigger new work
// after a completed no-match job. Ids are unique per queue, so the queues never coalesce
// with each other; the worker's freshness check stops the second lookup instead.
const hourlyEnqueue = (queue: PersistedQueue.PersistedQueue<OnboardingJob>, name: string) =>
	Effect.fn(name)(function* (input: { readonly uid: string; readonly email: string }) {
		const hour = Math.floor((yield* Clock.currentTimeMillis) / 3_600_000);
		const id = createHash("sha256")
			.update(JSON.stringify([input.uid, input.email, hour]))
			.digest("hex");
		yield* queue.offer({ version: 1, ...input }, { id });
	});

export class OnboardingQueue extends Context.Service<OnboardingQueue>()(
	"@hccnj/server/onboarding/OnboardingQueue",
	{
		make: Effect.gen(function* () {
			const queue = yield* PersistedQueue.make({
				name: "user-onboarding-v1",
				schema: OnboardingJobSchema,
				maxAttempts: 10,
			});
			// Weekly checks of complete profiles come due together after a Sunday, so they get
			// their own queue and consumer instead of sitting in front of signups and repairs.
			const refreshQueue = yield* PersistedQueue.make({
				name: "ccb-profile-refresh-v1",
				schema: OnboardingJobSchema,
				maxAttempts: 10,
			});
			const store = yield* PersistedQueue.PersistedQueueStore;
			return {
				offer: queue.offer,
				take: queue.take,
				enqueue: hourlyEnqueue(queue, "OnboardingQueue.enqueue"),
				takeRefresh: refreshQueue.take,
				enqueueRefresh: hourlyEnqueue(refreshQueue, "OnboardingQueue.enqueueRefresh"),
				// The store's cleanup is not per queue: it prunes both queues' rows.
				cleanup: store.cleanup({ timeToLive: Duration.days(7), failedTimeToLive: undefined }),
			};
		}),
	},
) {}

const SqlLive = Layer.unwrap(
	Effect.gen(function* () {
		const { database } = yield* AppConfig;
		if (!database.connectionString) {
			return yield* new OnboardingDatabaseConfigError({
				message: "Onboarding queue requires DATABASE_URL",
			});
		}
		return PgClient.layer({
			url: Redacted.make(database.connectionString),
			maxConnections: 3,
			connectTimeout: database.connectionTimeoutMs,
			idleTimeout: database.idleTimeoutMs,
			startupParameters: { statement_timeout: String(database.statementTimeoutMs) },
			applicationName: "hccna-onboarding",
		});
	}),
);

/**
 * An offer from this process wakes the worker at once, so polling only finds jobs other
 * processes enqueued and retries coming due. The default 1s poll ran ~86k queries a day.
 */
export const onboardingQueueStoreOptions = {
	tableName: "onboarding_queue",
	pollInterval: "30 seconds",
} as const;

const QueueStoreLive = PersistedQueue.layerStoreSql(onboardingQueueStoreOptions).pipe(
	Layer.provideMerge(SqlLive),
);

export const OnboardingQueueLive = Layer.effect(OnboardingQueue, OnboardingQueue.make).pipe(
	Layer.provideMerge(PersistedQueue.layer),
	Layer.provideMerge(QueueStoreLive),
);
