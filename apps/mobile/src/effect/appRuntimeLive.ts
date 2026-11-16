import { Effect, Layer, ManagedRuntime } from "effect";

import { AppCheckServiceLive } from "@/effect/appCheckServiceLive";
import { AppStartupServiceLive } from "@/effect/appStartupServiceLive";
import { AuthServiceLive } from "@/effect/authServiceLive";
import { AuthSessionServiceLive } from "@/effect/authSessionServiceLive";
import { GraphQLNetworkServiceLive } from "@/effect/graphqlNetworkServiceLive";
import { PushRegistrationServiceLive } from "@/effect/pushRegistrationServiceLive";
import { RelayPersistenceTelemetryServiceLive } from "@/effect/relayPersistenceTelemetryServiceLive";
import { RuntimeConfigServiceLive } from "@/effect/runtimeConfigServiceLive";
import { SentryServiceLive } from "@/effect/sentryServiceLive";
import { StatsigServiceLive } from "@/effect/statsigServiceLive";
import { StorageServiceLive } from "@/effect/storageServiceLive";

export const AppRuntimeLive = Layer.mergeAll(
  AppCheckServiceLive,
  AppStartupServiceLive,
  AuthServiceLive,
  AuthSessionServiceLive,
  GraphQLNetworkServiceLive,
  PushRegistrationServiceLive,
  RelayPersistenceTelemetryServiceLive,
  RuntimeConfigServiceLive,
  SentryServiceLive,
  StatsigServiceLive,
  StorageServiceLive,
);

export type AppRuntimeServices = Layer.Success<typeof AppRuntimeLive>;

export const liveAppRuntime = ManagedRuntime.make(AppRuntimeLive);

export function runLiveAppEffect<A, E>(
  effect: Effect.Effect<A, E, AppRuntimeServices>,
): Promise<A> {
  return liveAppRuntime.runPromise(effect);
}

export function runLiveAppEffectSync<A, E>(
  effect: Effect.Effect<A, E, AppRuntimeServices>,
): A {
  return liveAppRuntime.runSync(effect);
}
