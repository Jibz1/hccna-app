import { Effect } from "effect";

import { AppConfig } from "./AppConfig";

/**
 * Runs `start` (which forks the long-running workers) unless
 * BACKGROUND_WORKERS_ENABLED=false, as on standby deployments serving no traffic.
 */
export const whenBackgroundWorkersEnabled = <A, E, R>(start: Effect.Effect<A, E, R>) =>
	AppConfig.use((config) =>
		config.backgroundWorkers.enabled
			? Effect.asVoid(start)
			: Effect.logInfo("Background workers disabled"),
	);
