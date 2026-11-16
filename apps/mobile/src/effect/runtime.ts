import { Effect, Layer, ManagedRuntime } from "effect";

export const AppLive = Layer.mergeAll(Layer.empty);

export const appRuntime = ManagedRuntime.make(AppLive);

export function runAppEffect<A, E>(
  effect: Effect.Effect<A, E, never>,
): Promise<A> {
  return appRuntime.runPromise(effect);
}
