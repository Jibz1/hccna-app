import { AppConfig } from "@/effect/AppConfig";
import { serve } from "bun";
import { Effect } from "effect";

import type { createApp } from "@/app";

type BunServeOptions = Parameters<typeof serve>[0];
type HonoApp = Awaited<ReturnType<typeof createApp>>;
export type BunFetch = HonoApp["fetch"];

export interface BunServerHandle {
	readonly hostname: string | undefined;
	readonly port: number | undefined;
	stop: () => Promise<void>;
}

export type BunServe = (options: BunServeOptions) => BunServerHandle;

function stopServer(name: string, server: BunServerHandle) {
	return Effect.tryPromise({
		try: () => server.stop(),
		catch: (cause) => cause,
	}).pipe(
		Effect.catch((error) =>
			Effect.logWarning(`${name} server stop failed`).pipe(
				Effect.annotateLogs({
					error: error instanceof Error ? error.message : String(error),
				}),
			),
		),
	);
}

function disposeV1Handler() {
	return Effect.tryPromise({
		try: async () => {
			const { disposeV1WebHandler } = await import("@/routes/v1");
			await disposeV1WebHandler();
		},
		catch: (cause) => cause,
	}).pipe(
		Effect.catch((error) =>
			Effect.logWarning("v1 web handler dispose failed").pipe(
				Effect.annotateLogs({
					error: error instanceof Error ? error.message : String(error),
				}),
			),
		),
	);
}

export interface V1HandlerLifecycle {
	readonly warmUp: () => Promise<void>;
	readonly dispose: () => Effect.Effect<void>;
}

const defaultV1HandlerLifecycle: V1HandlerLifecycle = {
	warmUp: async () => {
		const { warmUpV1WebHandler } = await import("@/routes/v1");
		await warmUpV1WebHandler();
	},
	dispose: disposeV1Handler,
};

export function acquireApiServer(
	serveImpl: BunServe = serve,
	fetchImpl?: BunFetch,
	v1Lifecycle?: V1HandlerLifecycle,
) {
	const lifecycle = v1Lifecycle ?? defaultV1HandlerLifecycle;
	// The v1 handler is managed on the production path (no injected fetch) and
	// whenever a lifecycle is explicitly injected (tests exercising the flow).
	const manageV1Handler = fetchImpl === undefined || v1Lifecycle !== undefined;

	return Effect.acquireRelease(
		Effect.gen(function* () {
			const appConfig = yield* AppConfig;
			const fetch =
				fetchImpl ??
				(yield* Effect.promise(async () => {
					const { createApp } = await import("@/app");
					const app = await createApp(appConfig);
					return app.fetch;
				}));

			const server = yield* Effect.gen(function* () {
				if (manageV1Handler) {
					// Build the v1 HttpApi layer before accepting traffic: a build
					// failure must fail startup, not poison the first live request
					// (toWebHandler memoizes a rejected build promise forever).
					yield* Effect.promise(() => lifecycle.warmUp());
				}

				return serveImpl({
					idleTimeout: 20,
					fetch,
					port: appConfig.server.port,
					hostname: appConfig.server.hostname,
					development: appConfig.server.development,
				});
			}).pipe(
				// A failed warm-up or bind aborts acquisition before release exists,
				// which would strand the memoized v1 handler (and any poisoned build
				// promise inside it). Clear it so a retried acquisition rebuilds.
				Effect.onError(() => (manageV1Handler ? lifecycle.dispose() : Effect.void)),
			);

			yield* Effect.logInfo("API server listening").pipe(
				Effect.annotateLogs({
					hostname: server.hostname,
					port: server.port,
				}),
			);

			return server;
		}),
		(server) => stopServer("API", server).pipe(Effect.andThen(disposeV1Handler())),
	);
}
