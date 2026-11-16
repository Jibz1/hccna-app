import { buildRequestContextFromRequest, RequestContext } from "@/effect/RequestContext";
import { AppLayer, managedRuntime } from "@/effect/Runtime";
import { V1Api, V1PlatformLayer } from "@/routes/v1/api";
import { AttendanceExportsGroupLive } from "@/routes/v1/attendance-exports";
import * as Sentry from "@sentry/bun";
import { Cause, Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

/**
 * v1 defects never reject the web handler's promise — the router renders them
 * as a 500 Response internally — so Hono's onError (the Sentry capture path
 * for every other route) never observes them. This middleware captures and
 * logs the cause before the response is produced. Interrupts and typed
 * failures are not defects and pass through untouched.
 */
const makeV1DefectReporter =
	(capture: (defect: Error) => void) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		effect.pipe(
			Effect.tapCause((cause) => {
				if (!Cause.hasDies(cause)) {
					return Effect.void;
				}
				return Effect.sync(() => {
					const squashed = Cause.squash(cause);
					capture(squashed instanceof Error ? squashed : new Error(String(squashed)));
				}).pipe(Effect.andThen(Effect.logError("v1 route defect", cause)));
			}),
		);

// The v1 REST surface is served by effect's HttpApi. The handler layer is
// provided (via provideMerge + the shared memoMap) with the same AppLayer
// object managedRuntime uses, so service instances are built exactly once and
// shared with the GraphQL path.
const V1DefectReporterLayer = HttpRouter.use((router) =>
	router.addGlobalMiddleware(makeV1DefectReporter((defect) => Sentry.captureException(defect))),
);

const V1HandlerLayer = Layer.mergeAll(HttpApiBuilder.layer(V1Api), V1DefectReporterLayer).pipe(
	Layer.provide(AttendanceExportsGroupLive),
	Layer.provide(V1PlatformLayer),
	Layer.provideMerge(AppLayer),
);

type V1WebHandler = ReturnType<typeof createV1WebHandler>;

function createV1WebHandler() {
	return HttpRouter.toWebHandler(V1HandlerLayer, {
		memoMap: managedRuntime.memoMap,
		// The Hono pinoLogger middleware already logs every request; the
		// HttpRouter default logger would double-log.
		disableLogger: true,
	});
}

let webHandler: V1WebHandler | null = null;

export function getV1WebHandler(): V1WebHandler {
	webHandler ??= createV1WebHandler();
	return webHandler;
}

export async function disposeV1WebHandler(): Promise<void> {
	if (webHandler) {
		const { dispose } = webHandler;
		webHandler = null;
		await dispose();
	}
}

/**
 * Builds the v1 handler layer eagerly, before the server accepts traffic.
 *
 * toWebHandler defers the layer build to the first request AND memoizes a
 * rejected build promise forever — without this warm-up, one transient build
 * failure on the first live /v1 request would poison every subsequent /v1
 * request for the life of the instance while /readyz stays green. Building at
 * startup turns that failure mode into a failed boot.
 */
export async function warmUpV1WebHandler(): Promise<void> {
	const request = new Request("http://localhost/v1/__warmup");
	await getV1WebHandler().handler(
		request,
		Context.make(RequestContext, buildRequestContextFromRequest(request)),
	);
}
