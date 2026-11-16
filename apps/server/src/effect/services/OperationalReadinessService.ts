import { RedisService } from "@/effect/RedisService";
import { DbHealthService } from "@/effect/services/DbHealthService";
import { Context, Effect, Layer, Metric, Option, Schema } from "effect";

const ReadinessDependencySchema = Schema.Literals(["postgres", "redis"]);
const ReadinessFailureReasonSchema = Schema.Literals(["timeout", "unavailable"]);
const READINESS_DEPENDENCY_TIMEOUT = "2 seconds";

const readinessDependencyFailureCounter = Metric.counter("readiness_dependency_failures_total", {
	description: "Count of readiness dependency probe failures",
	incremental: true,
});

class ReadinessDependencyFailure extends Schema.Class<ReadinessDependencyFailure>(
	"ReadinessDependencyFailure",
)({
	dependency: ReadinessDependencySchema,
	reason: ReadinessFailureReasonSchema,
	message: Schema.String,
}) {}

interface OperationalReadinessServiceContract {
	readonly check: Effect.Effect<readonly ReadinessDependencyFailure[], never>;
}

function getErrorMessage(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause);
}

function createReadinessFailure(
	dependency: Schema.Schema.Type<typeof ReadinessDependencySchema>,
	reason: Schema.Schema.Type<typeof ReadinessFailureReasonSchema>,
	message: string,
) {
	return new ReadinessDependencyFailure({ dependency, reason, message });
}

function checkDependency(
	dependency: Schema.Schema.Type<typeof ReadinessDependencySchema>,
	check: Effect.Effect<unknown, unknown>,
): Effect.Effect<ReadinessDependencyFailure | null, never> {
	return check.pipe(
		Effect.as(null),
		Effect.timeoutOption(READINESS_DEPENDENCY_TIMEOUT),
		Effect.map((result) =>
			Option.isNone(result)
				? createReadinessFailure(
						dependency,
						"timeout",
						`readiness probe timed out after ${READINESS_DEPENDENCY_TIMEOUT}`,
					)
				: result.value,
		),
		Effect.catch((error) =>
			Effect.succeed(createReadinessFailure(dependency, "unavailable", getErrorMessage(error))),
		),
	);
}

export class OperationalReadinessService extends Context.Service<
	OperationalReadinessService,
	OperationalReadinessServiceContract
>()("OperationalReadinessService", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const dbHealth = yield* DbHealthService;

		const checkRedis = checkDependency("redis", redis.ping());
		const checkPostgres = checkDependency("postgres", dbHealth.check);

		const check: Effect.Effect<readonly ReadinessDependencyFailure[], never> = Effect.all(
			[checkRedis, checkPostgres],
			{
				concurrency: "unbounded",
			},
		).pipe(
			Effect.map((results) =>
				results.filter((result): result is ReadinessDependencyFailure => result !== null),
			),
			Effect.tap((failures) =>
				Effect.all(
					failures.map((failure) =>
						Metric.withAttributes(readinessDependencyFailureCounter, {
							dependency: failure.dependency,
							reason: failure.reason,
						}).pipe(Metric.update(1)),
					),
				),
			),
			Effect.withSpan("OperationalReadinessService.check"),
		);

		return { check } satisfies OperationalReadinessServiceContract;
	}),
}) {}

export const OperationalReadinessServiceLive = Layer.effect(
	OperationalReadinessService,
	OperationalReadinessService.make,
);
