import { AppConfig } from "@/effect/AppConfig";
import { serve } from "bun";
import { Effect } from "effect";

import type { BunFetch, BunServe, BunServerHandle } from "@/api";

function stopServer(server: BunServerHandle) {
	return Effect.tryPromise({
		try: () => server.stop(),
		catch: (cause) => cause,
	}).pipe(
		Effect.catch((error) =>
			Effect.logWarning("Metrics server stop failed").pipe(
				Effect.annotateLogs({
					error: error instanceof Error ? error.message : String(error),
				}),
			),
		),
	);
}

export function acquireMetricsServer(serveImpl: BunServe = serve, fetchImpl?: BunFetch) {
	return Effect.acquireRelease(
		Effect.gen(function* () {
			const appConfig = yield* AppConfig;
			const fetch =
				fetchImpl ??
				(yield* Effect.promise(async () => {
					const { metricsApp } = await import("@/app");
					return metricsApp.fetch;
				}));
			const metricsServer = serveImpl({
				fetch,
				port: appConfig.metrics.port,
			});

			yield* Effect.logInfo("Metrics server listening").pipe(
				Effect.annotateLogs({
					hostname: metricsServer.hostname,
					port: metricsServer.port,
				}),
			);

			return metricsServer;
		}),
		(server) => stopServer(server),
	);
}
