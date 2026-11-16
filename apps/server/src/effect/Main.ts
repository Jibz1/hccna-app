import { acquireApiServer } from "@/api";
import { acquireMetricsServer } from "@/metrics";
import { runOnboardingWorker } from "@/services/onboarding/onboardingWorker";
import { Effect, Fiber } from "effect";

import { AppConfig } from "./AppConfig";
import { whenBackgroundWorkersEnabled } from "./BackgroundWorkers";
import { waitForShutdownSignal } from "./ShutdownSignal";
import { StatsigService } from "./StatsigService";

function acquireStatsigService() {
	return Effect.acquireRelease(
		Effect.gen(function* () {
			yield* AppConfig;
			return yield* StatsigService;
		}),
		(statsig) =>
			Effect.tryPromise({
				try: () => statsig.shutdown(),
				catch: (cause) => cause,
			}).pipe(
				Effect.catch((error) =>
					Effect.logWarning("Statsig shutdown failed").pipe(
						Effect.annotateLogs({
							error: error instanceof Error ? error.message : String(error),
						}),
					),
				),
			),
	);
}

export const Main = Effect.scoped(
	Effect.gen(function* () {
		const shutdownSignalFiber = yield* Effect.forkScoped(waitForShutdownSignal());

		yield* AppConfig;
		yield* acquireStatsigService();
		yield* acquireMetricsServer();
		yield* acquireApiServer();
		yield* whenBackgroundWorkersEnabled(Effect.forkScoped(runOnboardingWorker));

		const signal = yield* Fiber.join(shutdownSignalFiber);
		yield* Effect.logInfo("Shutdown signal received").pipe(Effect.annotateLogs({ signal }));
	}),
);
