import { buildRequestContext, type RequestContext } from "@/effect/RequestContext";
import { runManagedRequestEffect, type AppRuntimeContext } from "@/effect/requestExecution";

import type { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import type { Effect } from "effect";
import type { Context } from "hono";

export type HonoEffectRunner = <
	A,
	E,
	R extends AppRuntimeContext | FirebaseAdminContext | RequestContext,
>(
	context: Context,
	program: Effect.Effect<A, E, R>,
) => Promise<A>;

export function runHonoEffect<
	A,
	E,
	R extends AppRuntimeContext | FirebaseAdminContext | RequestContext,
>(context: Context, program: Effect.Effect<A, E, R>): Promise<A> {
	return runManagedRequestEffect(buildRequestContext(context), program);
}
