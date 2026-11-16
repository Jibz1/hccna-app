import {
	buildRequestContextFromInput,
	RequestContext,
	type RequestContextInput,
	type RequestContextContract,
} from "@/effect/RequestContext";
import { managedRuntime } from "@/effect/Runtime";
import { Effect, type ManagedRuntime } from "effect";

import type { EffectRunner } from "@/effect/DataLoaderFactory";
import type { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";

export type AppRuntimeContext = ManagedRuntime.ManagedRuntime.Services<typeof managedRuntime>;

function provideRequestContext<A, E, R>(
	input: RequestContextInput,
	program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, RequestContext>> {
	return provideBuiltRequestContext(buildRequestContextFromInput(input), program);
}

function provideBuiltRequestContext<A, E, R>(
	requestContext: RequestContextContract,
	program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, RequestContext>> {
	return Effect.provideService(program, RequestContext, requestContext);
}

export function runManagedRequestEffect<
	A,
	E,
	R extends AppRuntimeContext | FirebaseAdminContext | RequestContext,
>(input: RequestContextInput, program: Effect.Effect<A, E, R>): Promise<A> {
	return managedRuntime.runPromise(provideRequestContext(input, program), {
		signal: input.signal,
	});
}

export function createManagedRequestEffectRunner(
	input: RequestContextInput,
): EffectRunner<AppRuntimeContext | FirebaseAdminContext | RequestContext> {
	const requestContext = buildRequestContextFromInput(input);

	return <A, E, R extends AppRuntimeContext | FirebaseAdminContext | RequestContext>(
		program: Effect.Effect<A, E, R>,
	) =>
		managedRuntime.runPromise(provideBuiltRequestContext(requestContext, program), {
			signal: input.signal,
		});
}
